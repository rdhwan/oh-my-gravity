---
name: omg-documents
description: Lightweight documentation specialist workflow for authoring or updating plans/<topic>/*.md, READMEs, and architecture markdown docs grounded in verified source files.
---

# OMG Documents (`/omg-documents`)

Generate or update Markdown documentation (`plans/<topic-slug>/` or project docs) using the `documents` specialist (`omg-documenter`). Read [the dispatch reference](../omg-orchestrator/references/dispatch.md).

## Steps

1. Check `omg-state.mjs status` to get the configured `documents` model and active plan topic.
2. If source context is missing, run a brief `explore` scout first so documentation never guesses APIs or paths.
3. Dispatch `documents` (`omg-documenter`) with exact target `.md` paths, verified facts/specs, and `plans/<topic-slug>/` conventions (`README.md` + `milestone-XX-<slug>.md`).
4. Run `omg-state.mjs sync-plans` afterward if `plans/` files were created or updated so the sidebar todo panel reflects them immediately.
5. Clean up finished `swarm` workers.
