---
name: omg-explore
description: Fast, low-cost codebase and documentation scouting via the OMG explore specialist. Returns file paths, line numbers, patterns, and a concise summary without polluting main context.
---

# OMG Explore (`/omg-explore`)

Scout the codebase or external docs using the lightweight `explore` role (`omg-explorer`). Read [the dispatch reference](../omg-orchestrator/references/dispatch.md) for backend routing.

## Steps

1. Check `omg-state.mjs status` to get the configured `explore` model and backend (`swarm` default or `subagent`).
2. Split multi-area questions into parallel `explore` workers (e.g., `explore-api`, `explore-ui`) with `workspace: "inherit"`.
3. Collect the `<results>` handoff(s), verify critical paths if needed, and return a clean, concise synthesis with exact `path:line` references.
4. Clean up finished `swarm` workers (`swarm({ action: "kill", name: "..." })`).
