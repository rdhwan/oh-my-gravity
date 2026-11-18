"""Unit tests for sidecars/omg-panel/context_report.py on synthetic conversation DBs."""

import importlib.util
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile
import unittest

SCRIPT = Path(__file__).resolve().parent.parent / "sidecars" / "omg-panel" / "context_report.py"
spec = importlib.util.spec_from_file_location("context_report", SCRIPT)
context_report = importlib.util.module_from_spec(spec)
spec.loader.exec_module(context_report)


def varint(n: int) -> bytes:
    n &= 0xFFFFFFFFFFFFFFFF
    out = b""
    while True:
        b = n & 0x7F
        n >>= 7
        if n:
            out += bytes([b | 0x80])
        else:
            return out + bytes([b])


def f(fn: int, val) -> bytes:
    if isinstance(val, int):
        return varint(fn << 3) + varint(val)
    if isinstance(val, str):
        val = val.encode()
    return varint(fn << 3 | 2) + varint(len(val)) + val


def m(*parts: bytes) -> bytes:
    return b"".join(parts)


class ConversationDB:
    def __init__(self, path: Path):
        self.conn = sqlite3.connect(path)
        self.conn.execute(
            "CREATE TABLE steps (idx integer, step_type integer NOT NULL DEFAULT 0, status integer NOT NULL DEFAULT 0, "
            "has_subtrajectory numeric NOT NULL DEFAULT false, metadata blob, error_details blob, permissions blob, "
            "task_details blob, render_info blob, step_payload blob, step_format integer NOT NULL DEFAULT 0, PRIMARY KEY (idx))"
        )
        self.conn.execute("CREATE TABLE gen_metadata (idx integer, data blob, size integer NOT NULL DEFAULT 0, PRIMARY KEY (idx))")
        self.n = 0

    def step(self, step_type: int, metadata: bytes = b"", payload_field: int | None = None, payload: bytes = b"", status: int = 3):
        pb = m(f(1, step_type), f(4, status), f(5, metadata), f(payload_field, payload) if payload_field else b"")
        self.conn.execute(
            "INSERT INTO steps (idx, step_type, status, metadata, step_payload) VALUES (?, ?, ?, ?, ?)",
            (self.n, step_type, status, metadata, pb),
        )
        self.n += 1

    def generation(self, groups: list[bytes], max_context: int = 1_000_000, usage: bytes = b"",
                   checkpoint_index: int = -1, model: str = "gemini-4-hydrogen-high", display_name: str = "Gemini 4 Hydrogen (High)"):
        cwm = m(f(1, 0), f(3, m(*[f(1, g) for g in groups])), f(4, max_context))
        chat = m(f(4, usage), f(9, m(f(2, checkpoint_index), f(10, cwm))), f(21, display_name) if display_name else b"")
        data = m(f(1, chat), f(3, f(28, model)))
        self.conn.execute("INSERT INTO gen_metadata (idx, data) VALUES ((SELECT COUNT(*) FROM gen_metadata), ?)", (data,))

    def close(self):
        if self.conn is not None:
            self.conn.commit()
            self.conn.close()
            self.conn = None


def group(token_type: int, tokens: int, *children: tuple[str, int], name: str = "group") -> bytes:
    return m(f(1, name), f(2, token_type), f(4, tokens), *[f(5, m(f(1, n), f(3, t))) for n, t in children])


def usage(input_tokens: int = 0, output: int = 0, cache_read: int = 0, thinking: int = 0, response: int = 0) -> bytes:
    return m(
        f(2, input_tokens),
        f(3, output),
        f(5, cache_read),
        f(9, thinking) if thinking else b"",
        f(10, response) if response else b"",
    )


USER_INPUT, PLANNER_RESPONSE, GENERIC = 14, 15, 132
P_USER, P_PLANNER = 19, 20


class ContextReportTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.home = Path(self.tmp.name)
        self.db_path = self.home / "11111111-1111-1111-1111-111111111111.db"
        self.db = ConversationDB(self.db_path)

    def tearDown(self):
        self.tmp.cleanup()

    def run_json(self) -> dict:
        self.db.close()
        env = dict(os.environ, HOME=str(self.home), USERPROFILE=str(self.home), PYTHONIOENCODING="utf-8")
        res = subprocess.run(
            [sys.executable, str(SCRIPT), "--db", str(self.db_path), "--json"],
            capture_output=True, env=env, text=True, encoding="utf-8", check=True,
        )
        return json.loads(res.stdout)

    def test_token_io_and_cached_metrics_across_generations(self):
        self.db.step(USER_INPUT, payload_field=P_USER, payload=f(2, "First question"))
        self.db.step(
            PLANNER_RESPONSE,
            metadata=f(9, usage(input_tokens=1000, output=150, cache_read=500, thinking=40)),
            payload_field=P_PLANNER,
            payload=f(1, "First answer"),
        )
        self.db.generation(
            [group(1, 500), group(7, 200, ("0: USER_INPUT", 20), ("1: PLANNER_RESPONSE", 180))],
            usage=usage(input_tokens=1000, output=150, cache_read=500, thinking=40),
        )

        self.db.step(USER_INPUT, payload_field=P_USER, payload=f(2, "Second question"))
        self.db.step(
            PLANNER_RESPONSE,
            metadata=f(9, usage(input_tokens=400, output=220, cache_read=2000, thinking=60)),
            payload_field=P_PLANNER,
            payload=f(1, "Second answer"),
        )
        self.db.generation(
            [group(1, 500), group(7, 450, ("0: USER_INPUT", 20), ("1: PLANNER_RESPONSE", 180), ("2: USER_INPUT", 30), ("3: PLANNER_RESPONSE", 220))],
            usage=usage(input_tokens=400, output=220, cache_read=2000, thinking=60),
        )

        report = self.run_json()
        self.assertEqual(report["model_id"], "gemini-4-hydrogen-high")
        self.assertEqual(report["used_tokens"], 950)
        self.assertEqual(report["limit_tokens"], 1_048_576)

        latest = report["token_usage"]["latest"]
        self.assertEqual(latest["input_tokens"], 400)
        self.assertEqual(latest["output_tokens"], 220)
        self.assertEqual(latest["cached_tokens"], 2000)
        self.assertEqual(latest["thinking_tokens"], 60)
        self.assertEqual(latest["cache_hit_pct"], 83.3)

        session = report["token_usage"]["session"]
        self.assertEqual(session["input_tokens"], 1400)
        self.assertEqual(session["output_tokens"], 370)
        self.assertEqual(session["cached_tokens"], 2500)
        self.assertEqual(session["thinking_tokens"], 100)
        self.assertEqual(session["generation_count"], 2)
        self.assertEqual(session["cache_hit_pct"], 64.1)

    def test_zero_usage_handles_cache_pct_cleanly(self):
        self.db.step(USER_INPUT, payload_field=P_USER, payload=f(2, "hello"))
        report = self.run_json()
        self.assertEqual(report["token_usage"]["latest"]["cache_hit_pct"], 0.0)
        self.assertEqual(report["token_usage"]["session"]["generation_count"], 0)

    def test_discover_child_conversations_from_steps_and_transcript(self):
        child1 = "22222222-2222-2222-2222-222222222222"
        child2 = "33333333-3333-3333-3333-333333333333"
        for cid in (child1, child2):
            cdb = ConversationDB(self.home / f"{cid}.db")
            cdb.step(USER_INPUT, payload_field=P_USER, payload=f(2, "child task"))
            cdb.close()

        tc_md = f(4, m(f(2, "invoke_subagent"), f(3, json.dumps({"TypeName": "omg-explorer", "Role": "Scout"}))))
        self.db.step(127, metadata=tc_md, payload_field=140, payload=f(2, child1))
        self.db.close()

        brain_logs = self.home / "brain" / self.db_path.stem / ".system_generated" / "logs"
        brain_logs.mkdir(parents=True, exist_ok=True)
        transcript = brain_logs / "transcript.jsonl"
        transcript.write_text(
            json.dumps({"tool_calls": [{"name": "swarm", "args": {"action": "\"add\"", "name": "\"build-m1\""}}]}) + "\n"
            + json.dumps({"content": f"Started worker {child2}"}) + "\n",
            encoding="utf-8",
        )

        res = subprocess.run(
            [sys.executable, str(SCRIPT), "--db", str(self.db_path), "--discover-children", "--brain-dir", str(self.home / "brain")],
            capture_output=True, text=True, encoding="utf-8", check=True,
        )
        data = json.loads(res.stdout)
        ids = {c["conversation_id"]: c for c in data["children"]}
        self.assertIn(child1, ids)
        self.assertIn(child2, ids)
        self.assertEqual(ids[child1]["label"], "Scout")
        self.assertEqual(ids[child2]["label"], "build-m1")


if __name__ == "__main__":
    unittest.main()
