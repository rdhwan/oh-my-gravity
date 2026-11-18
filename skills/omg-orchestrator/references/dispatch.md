# OMG Dispatch & State Reference

## 1. Resolving Plugin Scripts & Effective Config

In shell commands, locate `omg-state.mjs` via:
1. `<this-plugin-root>/scripts/omg-state.mjs` (or `~/.gemini/config/plugins/omg/scripts/omg-state.mjs`).

Inspect effective models, backend mode, and active milestone state:
```bash
node ~/.gemini/config/plugins/omg/scripts/omg-state.mjs status --workspace "<workspace-root>"
```

## 2. Backend Dispatch Rules

Read `config.backend` and `config.agents.<role>` from `status` output (`swarm` is the default; `PreToolUse` hooks also enforce the configured model automatically):

### When backend is `swarm` (default)
- **Scout (`explore`)**: `swarm({ action: "add", name: "explore-scout", model: "<config.agents.explore.model>", workspace: "inherit", brief: "..." })`
- **Planner (`plan`)**: `swarm({ action: "add", name: "plan-architect", model: "<config.agents.plan.model>", workspace: "inherit", brief: "..." })`
- **Documenter (`documents`)**: `swarm({ action: "add", name: "documents-writer", model: "<config.agents.documents.model>", workspace: "inherit", brief: "..." })`
- **Builder (`build`)**:
  - Sequential single-writer milestone: `swarm({ action: "add", name: "build-m1", model: "<config.agents.build.model>", workspace: "inherit", brief: "..." })`
  - Parallel disjoint lanes: use `workspace: "share"` with explicit non-overlapping file ownership, and merge changes before killing.
- **Oracle (`oracle`)**: `swarm({ action: "add", name: "oracle-verify", model: "<config.agents.oracle.model>", workspace: "inherit", brief: "..." })`
- End the turn after dispatching swarm workers so completion wakeups resume you; call `swarm({ action: "kill", name: "..." })` once a worker's output is accepted and landed.

### When backend is `subagent`
- Call `invoke_subagent` with `TypeName`: `omg-explorer`, `omg-planner`, `omg-documenter`, `omg-builder`, or `omg-oracle`, and `Model`: `config.agents.<role>.tier` (`flash_lite`, `flash`, `pro`, or `inherit`).

## 3. Keeping Sidebar Milestones & Todos Live

- **Seed plan** (pass JSON via stdin or `--file`):
  ```bash
  node ~/.gemini/config/plugins/omg/scripts/omg-state.mjs init-plan --workspace "<root>" --topic "<topic-slug>" --title "<Title>" --file .omg/drafts/plan.json
  ```
  Plan JSON shape:
  ```json
  {
    "topic": "auth-refactor",
    "title": "Auth Refactor",
    "milestones": [
      {
        "id": "m1",
        "title": "Milestone 1: Token Middleware",
        "goal": "Validate JWTs at API boundary",
        "planSummary": "1. Add verify helper\n2. Wire middleware\n3. Add unit tests",
        "todos": [
          { "id": "t1", "title": "Implement verifyJwt helper", "assignee": "build" },
          { "id": "t2", "title": "Add middleware unit tests", "assignee": "build" }
        ]
      }
    ]
  }
  ```
- **Materialize `plans/<topic-slug>/` (only when user approves)**:
  ```bash
  node ~/.gemini/config/plugins/omg/scripts/omg-state.mjs write-plans --workspace "<root>" --topic "<topic-slug>"
  ```
- **Update milestone & sub-todos during execution**:
  ```bash
  node ~/.gemini/config/plugins/omg/scripts/omg-state.mjs milestone-status m1 in_progress --workspace "<root>" --topic "<topic-slug>"
  node ~/.gemini/config/plugins/omg/scripts/omg-state.mjs todo-update m1 t1 done --workspace "<root>" --topic "<topic-slug>" --note "Implemented in src/auth.ts"
  node ~/.gemini/config/plugins/omg/scripts/omg-state.mjs agent-activity build idle --workspace "<root>"
  ```
