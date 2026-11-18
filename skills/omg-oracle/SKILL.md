---
name: omg-oracle
description: High-reasoning verification and architectural review via the OMG oracle specialist. Audits implementation against milestone goals and produces an actionable repair list if issues remain.
---

# OMG Oracle (`/omg-oracle`)

Run a rigorous correctness, architecture, and milestone-adherence audit using the `oracle` specialist (`omg-oracle`). Read [the dispatch reference](../omg-orchestrator/references/dispatch.md).

## Steps

1. Run `omg-state.mjs status` to get the configured `oracle` model and active milestone plan.
2. Gather the relevant `plans/<topic>/*.md` goals, changed file paths, and observed test outputs.
3. Dispatch `oracle` (`omg-oracle`) with `workspace: "inherit"` (read-only) to verify every milestone goal and acceptance criterion against the actual code and check evidence.
4. Present Oracle's `PASS` / `FAIL` verdict and findings to the user. If `FAIL` and the user wants fixes applied, hand the defect list to `/omg-build` (`omg-builder`) and re-verify.
5. Clean up finished `swarm` workers.
