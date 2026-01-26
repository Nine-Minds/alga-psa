# Workflow Fixture Harness — Scratchpad

## 2026-01-26
- Created plan scratchpad (this file) to track implementation notes, commands, and decisions for the workflow harness + fixtures work.
- F001: Added `tools/workflow-harness/` with initial `run.cjs` entrypoint and `README.md` usage/conventions.
- F002: Implemented CLI arg parsing + validation in `tools/workflow-harness/run.cjs` (supports cookie-file with newline trimming).
- F003: Added fixture discovery + required file validation (`bundle.json`, `test.cjs`).
- F004: Added `tools/workflow-harness/lib/context.cjs` (ctx config, logging, cleanup registration/execution).
- F005: Added `tools/workflow-harness/lib/http.cjs` (fetch wrapper that sets Cookie + x-tenant-id).
