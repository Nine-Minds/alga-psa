# Workflow Fixture Harness — Scratchpad

## 2026-01-26
- Created plan scratchpad (this file) to track implementation notes, commands, and decisions for the workflow harness + fixtures work.
- F001: Added `tools/workflow-harness/` with initial `run.cjs` entrypoint and `README.md` usage/conventions.
- F002: Implemented CLI arg parsing + validation in `tools/workflow-harness/run.cjs` (supports cookie-file with newline trimming).
- F003: Added fixture discovery + required file validation (`bundle.json`, `test.cjs`).
- F004: Added `tools/workflow-harness/lib/context.cjs` (ctx config, logging, cleanup registration/execution).
- F005: Added `tools/workflow-harness/lib/http.cjs` (fetch wrapper that sets Cookie + x-tenant-id).
- F006: Added `tools/workflow-harness/lib/db.cjs` (read-only Postgres client via `DATABASE_URL` / connection string).
- F007: Added `tools/workflow-harness/lib/workflow.cjs#importWorkflowBundleV1` (wraps `/api/workflow-definitions/import` with `?force=true`).
- F008: Added `tools/workflow-harness/lib/workflow.cjs#exportWorkflowBundleV1` (wraps `/api/workflow-definitions/:id/export`).
- F009: Added `tools/workflow-harness/lib/runs.cjs#waitForRun` (polls `workflow_runs` by workflowId + tenantId after trigger time).
- F010: Added `tools/workflow-harness/lib/runs.cjs#getRunSteps` + `summarizeSteps` (+ `getRunLogs` for artifacts).
- F011: Wired `tools/workflow-harness/run.cjs` to execute one fixture and emit single-line `PASS/FAIL <testId> <durationMs>` with exit codes.
- F012: Added failure artifact writing (`tools/workflow-harness/lib/artifacts.cjs` + harness wiring) capturing error, import summary, workflow export, run/steps/logs when available.
- F013: Added fixture root `ee/test-data/workflow-harness/` with README and conventions.
- F014: Added golden fixture `ee/test-data/workflow-harness/ticket-created-hello/` (published workflow, triggers via `/api/workflow/events`, asserts run SUCCEEDED).
- F015: Standardized fixture key convention (`fixture.<folderName>`) and documented always using `--force` imports for reruns.
- F016: Added harness assertion/timeouts (`tools/workflow-harness/lib/expect.cjs`) and exposed via `ctx.expect`; harness enforces a global timeout.
- F017: Enabled `--debug` verbose logging (import summary + workflow id/key + HTTP/DB debug logs).
- F018: Implemented `--json` output (adds a machine-readable JSON line after PASS/FAIL).
