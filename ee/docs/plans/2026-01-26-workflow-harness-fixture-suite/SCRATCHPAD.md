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
- F019: Added fixture scaffolder `tools/workflow-harness/scaffold.cjs` (creates `bundle.json` + `test.cjs` in `ee/test-data/workflow-harness/<name>`).
- F020: Documented fixture naming scheme + category prefixes in `ee/test-data/workflow-harness/README.md`.
- F021: Harness always runs registered cleanup hooks after each fixture (on pass or fail), and records cleanup errors into artifacts.

## Tests
- T001: Added Node test `tools/workflow-harness/tests/args-errors.test.cjs` validating the CLI errors clearly when `--test` is omitted.
- T002: Added Node test coverage for missing `bundle.json` fixture file (fails before DB/HTTP work).
- T003: Added Node test coverage for missing `test.cjs` fixture file (fails before DB/HTTP work).
- T004: Added stubbed runner test `tools/workflow-harness/tests/runner-stubbed.test.cjs` validating `--force` is passed to import and ctx exposes workflow id/key.
- T005: Added stubbed runner test ensuring thrown errors are surfaced and `failure.*` artifacts include stack trace.
- T006: Added stubbed runner test ensuring wait timeouts include diagnostics (`err.details`) and are captured into failure artifacts.
- T007: Added stubbed runner test ensuring successful runs capture `run` + `steps` into the result state for summaries/JSON output.
- T008: Added stubbed runner test for PASS/FAIL line format and exit code via exported `runCliOnceForTests`.
- T009: Added cookie-file unit test and extracted `readCookieFromFile` into `tools/workflow-harness/lib/cookie.cjs` (trims whitespace/newlines).
- T010: Added stubbed runner test that asserts `--debug` emits verbose logs (import summary + workflow id/key).
