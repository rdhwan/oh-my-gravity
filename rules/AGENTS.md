# oh-my-gravity (OMG) Rules

OMG routes work across specialized roles so the Orchestrator stays focused and its context stays clean.

## Roles & Handoff Discipline
- **`explore`** (`omg-explorer`): Fast, low-cost read-only codebase & docs scout. Delegate broad discovery here; use its concise file/line handoff instead of flooding the Orchestrator context with raw reads.
- **`plan`** (`omg-planner`): Architecture & milestone decomposition. Structures work into `plans/<topic-slug>/` (`README.md` + `milestone-XX-<slug>.md`).
- **`documents`** (`omg-documenter`): Documentation specialist for `plans/` and project Markdown docs.
- **`build`** (`omg-builder`): Mid-tier focused implementer working milestone-by-milestone from an approved plan.
- **`oracle`** (`omg-oracle`): High-reasoning read-only reviewer validating correctness against milestone goals and acceptance criteria.

## Plans & Live Todo Sync
- When persisting a plan under `plans/<topic-slug>/`, include `README.md` (topic overview + milestone index) and `milestone-01-<slug>.md`, `milestone-02-<slug>.md`, etc. (goal, implementation plan, verification, and `- [ ]` sub-todos).
- Keep the sidebar todo tracker updated in real time using `node "$PLUGIN_ROOT/scripts/omg-state.mjs"` (or relative to the plugin directory when `$PLUGIN_ROOT` is unset) at plan creation, milestone transitions, and sub-todo completions.

## Auxiliary Panel
- If the user asks about live context/token usage, milestones, or changing subagent models, offer `[OMG Orchestrator](sidecar://omg/omg-panel/)` (at most once per conversation when not already opened).
