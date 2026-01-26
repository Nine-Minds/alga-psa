# Workflow Harness Fixtures

Each fixture is a folder containing:
- `bundle.json` — a Workflow Bundle v1 (usually 1 workflow) with a deterministic `workflow.key` like `fixture.<name>`
- `test.cjs` — trigger + assertions script executed by `tools/workflow-harness/run.cjs`

## Conventions

- Folder name becomes the harness `testId` (e.g. `ticket-created-hello`).
- Workflow key should be `fixture.<folderName>`.
- Prefer `--force` imports so fixtures are re-runnable.
- Tests should register cleanup via `ctx.onCleanup(fn)` when they create domain records.

## Naming scheme

Use a consistent, grep-friendly naming scheme:
- `<domain>-<event>-<behavior>` (examples: `ticket-created-hello`, `project-created-kickoff-tasks`, `invoice-overdue-reminder`)

Recommended domains:
- `ticket-*`, `project-*`, `invoice-*`, `payment-*`, `contract-*`, `appointment-*`, `schedule-*`, `company-*`, `time-*`
