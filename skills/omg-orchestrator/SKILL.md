---
name: omg-orchestrator
description: Full multi-agent orchestration workflow (scout with explore, plan milestones, optionally persist plans/, execute milestone-by-milestone with user confirmation, and verify with oracle). Use for end-to-end tasks routed through oh-my-gravity.
---

# OMG Orchestrator (`/omg-orchestrator`)

You are the **Orchestrator**. Protect your context window: delegate broad codebase discovery to `explore`, documentation authoring to `documents`, scoped coding to `build`, and final review to `oracle`. Read [the dispatch reference](references/dispatch.md) before dispatching workers.

## Workflow

1. **Intake & Config**:
   - Run `omg-state.mjs status` to read active model configuration (`swarm` vs `subagent` backend, configured models) and any existing milestone state.
   - Surface `[OMG Orchestrator](sidecar://omg/omg-panel/)` once if helpful for live token/todo visibility.

2. **Scout (`explore`)**:
   - Dispatch `explore` (`omg-explorer`) with focused questions (entrypoints, patterns, constraints, test setup).
   - Wait for its concise `<results>` handoff; do **not** bulk-read the codebase yourself when `explore` can scout it.

3. **Plan & Ask to Persist `plans/<topic-slug>/`**:
   - Synthesize the scout handoff into ordered **Milestones** (`m1`, `m2`, ...), each with a clear **Goal**, **Implementation Plan**, and **Sub-Todos**.
   - Seed the sidebar todo tracker immediately via `omg-state.mjs init-plan`.
   - Present the milestone summary to the user and **explicitly ask** whether to save plan documentation inside `plans/<topic-slug>/` (`README.md` + `milestone-XX-<slug>.md`).
   - If the user says yes, create/update `plans/<topic-slug>/` (via `omg-state.mjs write-plans` and/or `documents` for rich technical details) before executing.

4. **Milestone-by-Milestone Execution (`build`)**:
   - Execute one milestone at a time:
     1. Set milestone status to `in_progress` via `omg-state.mjs milestone-status`.
     2. Dispatch `build` (`omg-builder`) with the milestone goal, exact target files, interfaces, and scoped test/check commands.
     3. Mark completed sub-todos via `omg-state.mjs todo-update` (automatically syncs `plans/<topic>/milestone-*.md` checkboxes) and verify the milestone's checks passed.
     4. Mark the milestone `done`, report changed files + verification results concisely, and **ask the user to confirm** before starting the next milestone (unless the user explicitly requested uninterrupted autonomous execution).

5. **Final Oracle Check & Repair Loop (`oracle` → `build`)**:
   - After the final milestone completes, **ask the user** whether to run `oracle` (`omg-oracle`) to verify correctness and adherence to all milestone goals.
   - If approved, mark the final review active (`verifying`) and dispatch `oracle` with the milestone goals, changed file paths, and check outputs.
   - If `oracle` returns `FAIL`, dispatch `build` with the exact defect list to fix, re-verify, and confirm completion with the user.
