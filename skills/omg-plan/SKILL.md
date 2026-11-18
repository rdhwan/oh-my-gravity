---
name: omg-plan
description: Planning-only OMG workflow. Scouts the codebase with explore, designs ordered milestones and sub-todos, updates the sidebar tracker, and optionally writes plans/<topic-slug>/*.md without implementing code.
---

# OMG Plan (`/omg-plan`)

Create an actionable, milestone-structured plan without making code changes. Read [the dispatch reference](../omg-orchestrator/references/dispatch.md) for config and `omg-state.mjs` commands.

## Steps

1. Run `omg-state.mjs status` to inspect configured models and existing `plans/` topics.
2. Dispatch `explore` (`omg-explorer`) to scout relevant files, architecture boundaries, and test harnesses so your context stays concise.
3. Synthesize (or delegate complex architecture breakdown to `plan` / `omg-planner`) ordered **Milestones** (`m1`, `m2`, ...) with:
   - Milestone **Goal**
   - Concrete **Implementation Plan** (files, interfaces, verification command)
   - Actionable **Sub-Todos** (`t1`, `t2`, ...)
4. Seed the sidebar tracker with `omg-state.mjs init-plan`.
5. Present the plan to the user and **ask whether to persist it under `plans/<topic-slug>/`** (`README.md` + `milestone-XX-<slug>.md`). If approved, run `omg-state.mjs write-plans` (and optionally `documents` to enrich details).
6. Stop after planning — do not start implementation unless the user triggers `/omg-build` or `/omg-orchestrator`.
