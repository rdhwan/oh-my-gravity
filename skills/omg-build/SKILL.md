---
name: omg-build
description: Focused OMG builder workflow to implement a specific milestone, plan file, or scoped engineering task using the configured build model and updating sidebar todos.
---

# OMG Build (`/omg-build`)

Execute a well-scoped implementation task or milestone using the `build` specialist (`omg-builder`). Read [the dispatch reference](../omg-orchestrator/references/dispatch.md).

## Steps

1. Run `omg-state.mjs status` to inspect the configured `build` model and any active milestone/todos.
2. If the user references a `plans/<topic>/milestone-*.md` or active milestone, load its goal, plan, and sub-todos, and set the milestone status to `in_progress`.
3. Dispatch `build` (`omg-builder`) with exact scope, target files, interfaces, and required verification command(s). Use `workspace: "inherit"` for a single sequential writer, or `workspace: "share"` for parallel non-overlapping lanes.
4. Update completed sub-todos via `omg-state.mjs todo-update` and mark the milestone `done` once verified.
5. Clean up finished `swarm` workers (landing any `share` changes first) and report changed files + exact test/check results.
