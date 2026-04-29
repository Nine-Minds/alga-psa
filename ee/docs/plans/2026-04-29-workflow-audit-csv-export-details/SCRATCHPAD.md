# Scratchpad — Workflow Audit CSV Export Details

- Plan slug: `workflow-audit-csv-export-details`
- Created: `2026-04-29`

## What This Is

Rolling notes for improving workflow audit CSV exports so the CSV is business-readable while retaining technical references for support.

## Decisions

- (2026-04-29) Use one CSV format for both business readability and support troubleshooting. Rationale: user selected option C; readable columns should be first and technical references should be retained at the end.
- (2026-04-29) Use a hybrid formatter. Known audit operations get first-class columns and summaries; unmapped safe scalar fields go into `additional_details`. Rationale: avoids raw JSON while preventing silent detail loss.
- (2026-04-29) Actor column should be human-readable, with `actor_user_id` retained as a separate trailing technical column.
- (2026-04-29) Workflow/run context should prioritize readable columns up front, with raw IDs near the end.
- (2026-04-29) JSON export remains the raw/lossless redacted export. CSV becomes the business-readable audit report.
- (2026-04-29) Do not add legacy CSV mode in v1 unless a known downstream consumer appears.

## Discoveries / Constraints

- (2026-04-29) Current CSV export in `ee/packages/workflows/src/actions/workflow-runtime-v2-actions.ts` only includes `timestamp`, `operation`, `user_id`, `table_name`, and `record_id`.
- (2026-04-29) Current export path already redacts `changed_data` and `details` via `listWorkflowAuditLogsAction()` before CSV/JSON serialization.
- (2026-04-29) Current export limit is `EXPORT_AUDIT_LIMIT = 5000`.
- (2026-04-29) Definition audit UI caller: `ee/server/src/components/workflow-designer/WorkflowDefinitionAudit.tsx`.
- (2026-04-29) Run audit UI caller: `ee/server/src/components/workflow-designer/WorkflowRunDetails.tsx`.
- (2026-04-29) API routes import `exportWorkflowAuditLogsAction()`, so improving that action improves route exports too.
- (2026-04-29) `auditWorkflowEvent()` appends `actorRoles` and `source` to details for action-written workflow audit rows.
- (2026-04-29) Runtime `writeRunAudit()` can produce workflow run audit rows with `action_id`, `action_version`, and `step_path` in details.

## Commands / Runbooks

- (2026-04-29) Relevant search command used during planning:
  - `rg -n "exportWorkflowAuditLogsAction|EXPORT_AUDIT_LIMIT|ListWorkflowAuditLogsInput|workflow_definition_|workflow_run_" ee/packages/workflows/src/actions ee/server/src/components/workflow-designer server/src/app/api/workflow-definitions server/src/app/api/workflow-runs packages/db/src/lib/auditLog.ts shared/workflow/runtime/actions/businessOperations/shared.ts`
- (2026-04-29) Before implementation, inspect package test conventions around workflow actions and choose whether formatter helpers should be inline or separated for direct unit testing.

## Links / References

- `ee/packages/workflows/src/actions/workflow-runtime-v2-actions.ts`
- `ee/packages/workflows/src/actions/workflow-runtime-v2-schemas.ts`
- `ee/server/src/components/workflow-designer/WorkflowDefinitionAudit.tsx`
- `ee/server/src/components/workflow-designer/WorkflowRunDetails.tsx`
- `server/src/app/api/workflow-definitions/[workflowId]/audit/export/route.ts`
- `server/src/app/api/workflow-runs/[runId]/audit/export/route.ts`
- `packages/db/src/lib/auditLog.ts`
- `shared/workflow/runtime/actions/businessOperations/shared.ts`

## Open Questions

- Confirm exact automated test location and runner for workflow action/export helpers.
- Decide whether to keep formatter helpers in `workflow-runtime-v2-actions.ts` or extract to a dedicated helper module for cleaner tests.

## Implementation Log

- (2026-04-29) Implemented business-readable workflow audit CSV formatter helpers in `ee/packages/workflows/src/actions/workflow-audit-csv.ts`.
  - Added stable CSV headers in required business-first order with trailing technical references.
  - Added known operation -> event mapping plus readable unknown-operation fallback.
  - Added flattening logic for source/workflow version/run status/reason/step path/action and changed-fields synthesis.
  - Added `additional_details` scalar extraction and object/array summaries (`object`, `N items`) to avoid raw JSON blobs.
  - Added actor formatting helper for full-name+email, email-only, name-only, unresolved fallback.
- (2026-04-29) Updated `exportWorkflowAuditLogsAction()` to use formatter helpers and enrichment while preserving default CSV contract and JSON branch behavior.
  - Preserved input parsing, export limit behavior, and filename/content-type behavior.
  - CSV branch now enriches actor display names from `users` and workflow/run context from `workflow_definitions`/`workflow_runs`.
  - JSON branch remains `JSON.stringify(result.logs, null, 2)` over redacted rows.
- (2026-04-29) Added formatter unit tests in `ee/packages/workflows/src/actions/workflow-audit-csv.test.ts` covering representative definition mapping, unknown fallback/additional details, CSV escaping, redaction-preservation, and actor formatting variants.

## Verification Runbook

- `npx vitest --root ee/packages/workflows src/actions/workflow-audit-csv.test.ts`
- `npx tsc -p ee/packages/workflows/tsconfig.json --noEmit`

## Gotchas

- `WorkflowDefinitionModelV2.getById` requires tenant and cannot be called with null tenant; export enrichment uses direct `workflow_definitions` query with optional tenant filter from audit rows.
- Definition key field is `key` (not `workflow_key`) on `workflow_definitions` records.
