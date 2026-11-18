# oh-my-gravity (OMG)

<p align="center"><img src="logos/omg.png" alt="OMG Logo" width="140"></p>

A native **Antigravity 2.0** multi-agent orchestrator plugin combining tiered specialist handoffs, milestone-driven planning (`plans/<topic>/`), and a live 3-part Aux Pane sidebar.

## Features

- **6 Entrypoint Commands**:
  - `/omg-orchestrator` — End-to-end orchestration: scout (`explore`) → milestone plan → optional `plans/<topic>/` persistence → milestone-by-milestone `build` with confirmation → optional `oracle` verification & `build` repair loop.
  - `/omg-plan` — Standalone scout + milestone breakdown + optional `plans/<topic>/` generation.
  - `/omg-explore` — Fast, cheap codebase & docs scout returning concise `path:line` handoffs.
  - `/omg-documents` — Lightweight Markdown & `plans/` documentation writer.
  - `/omg-build` — Mid-tier focused builder executing scoped milestones.
  - `/omg-oracle` — High-reasoning read-only reviewer validating correctness against milestone goals.
- **Per-Agent Model Routing (`swarm` default + `subagent` option)**:
  - Defaults to `swarm` workers so every specialist uses the exact model ID configured in the sidebar.
  - `PreToolUse` hooks automatically enforce configured models on `swarm` and `invoke_subagent` calls.
- **OMG Orchestrator Sidebar (`sidecars/omg-panel/`)**:
  1. **Context & Token Usage Monitor**: Live context window grid, category breakdown, and **Input / Output / Cached / Thinking** token metrics (latest turn + session cumulative) read directly from Antigravity's conversation SQLite DB with zero LLM token overhead.
  2. **Milestones & Sub-Todos**: Live milestone tree synced with `.omg/state/todos.json` and `plans/<topic>/*.md` checkboxes.
  3. **Agent & Model Configurator**: Live dropdowns populated from `GetAvailableModels`, persisted to `~/.gemini/config/omg/config.json` (Global) or `<workspace>/.omg/config.json` (Workspace).

## Local Installation (Antigravity 2.0)

```bash
node scripts/install-local.mjs
```

Then open **Customizations** in Antigravity 2.0, enable **oh-my-gravity (OMG)**, and open **OMG Orchestrator** in the right-hand auxiliary pane.

## Tests

```bash
python3 -m unittest discover -s tests -p "test_*.py" -v
node --test tests/omg.test.mjs
```
