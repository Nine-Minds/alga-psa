# PRD — Workflow Audit CSV Export Details

- Slug: `workflow-audit-csv-export-details`
- Date: `2026-04-29`
- Status: Ready for implementation

## Summary

Improve workflow audit CSV exports so they are business-readable while still useful for support troubleshooting. The current CSV export includes only `timestamp`, `operation`, `user_id`, `table_name`, and `record_id`, which exposes mostly raw IDs and omits the useful audit context stored in redacted `changed_data` and `details` JSON fields.

The improved CSV should flatten known workflow audit information into stable, human-friendly columns, enrich actors and workflow/run context where possible, and include unmapped safe scalar details in a readable `additional_details` column. JSON export remains the lossless raw redacted export.

## Problem

Workflow audit logs contain important detail about workflow definition changes and workflow run operations, but the CSV export currently drops most of that detail because it avoids exporting JSON fields. As a result, exported CSVs are hard to use for compliance review, customer-facing audit review, or internal support because they contain raw IDs without business context and no clear explanation of what changed.

Simply stringifying JSON into CSV would preserve data, but it would produce poor spreadsheet usability and force users to parse internal implementation structures. The desired export is a clean audit report: readable first, with technical references retained at the end for debugging.

## Goals

- Replace the current workflow audit CSV body with a stable business-readable CSV format.
- Flatten known workflow audit `changed_data` and `details` fields into first-class columns.
- Preserve unmapped safe scalar fields in `additional_details` using `key=value; key=value` text, not raw JSON.
- Enrich `user_id` into a readable `actor` column while retaining `actor_user_id` near the end.
- Enrich workflow definition and run context into readable columns such as workflow name, key, version, and run status.
- Keep raw support/debug references in trailing columns, including workflow/run/audit IDs.
- Preserve existing permission checks, tenant checks, row limit behavior, filenames, and content type.
- Keep JSON export unchanged as the raw redacted export.
- Continue redacting sensitive values before any CSV formatting.

## Non-goals

- Do not add multiple CSV export modes in v1, such as separate business and technical CSVs.
- Do not preserve the old 5-column CSV shape unless a downstream consumer is discovered.
- Do not export raw JSON blobs in CSV columns.
- Do not change audit log writes or database schema.
- Do not expand workflow audit permissions beyond the current admin-gated export behavior.
- Do not add new observability, metrics, or feature-flag infrastructure for this change.

## Users and Primary Flows

1. Admin exports workflow definition audit CSV
- User opens a workflow definition audit tab.
- User clicks `Export CSV`.
- Browser downloads the existing filename pattern.
- CSV rows show readable events like `Workflow published`, `Workflow settings updated`, and `Workflow draft saved`.
- Early columns identify actor, workflow name/key/version, status, reason, summary, and relevant changed fields.
- Trailing columns preserve IDs for support correlation.

2. Admin exports workflow run audit CSV
- User opens workflow run details.
- User clicks audit `Export`.
- CSV rows show readable run events such as `Run started`, `Run canceled`, `Run retried`, and runtime action-level audit events.
- Run rows include workflow name, version, current status, reasons, step path, action metadata, and support IDs.

3. Support/compliance reviewer opens CSV in a spreadsheet
- Reviewer can understand what happened without decoding UUIDs or JSON.
- Reviewer can filter by event, actor, source, status, reason, step path, or changed fields.
- If escalation requires deeper debugging, support can use trailing internal IDs or request the JSON export.

## UX / UI Notes

- Existing buttons and labels can remain unchanged for v1.
- The CSV file should remain a standard single-header CSV with stable columns.
- Business-readable columns should come first; raw/internal reference columns should come last.
- The JSON export, including API route behavior, remains available for raw row inspection.
- No new UI controls are required unless future work introduces export-mode selection.

## Requirements

### Functional Requirements

- `exportWorkflowAuditLogsAction()` must continue to accept the existing inputs and return CSV by default.
- CSV export must use a stable set of columns:
  - `timestamp`
  - `event`
  - `actor`
  - `source`
  - `workflow_name`
  - `workflow_key`
  - `workflow_version`
  - `run_status`
  - `reason`
  - `step_path`
  - `action`
  - `changed_fields`
  - `summary`
  - `additional_details`
  - `actor_user_id`
  - `workflow_id`
  - `run_id`
  - `record_type`
  - `operation`
  - `audit_id`
- CSV export must map known operations to readable event labels:
  - `workflow_definition_create` → `Workflow created`
  - `workflow_definition_update` → `Workflow draft saved`
  - `workflow_definition_metadata_update` → `Workflow settings updated`
  - `workflow_definition_delete` → `Workflow deleted`
  - `workflow_definition_publish` → `Workflow published`
  - `workflow_run_start` → `Run started`
  - `workflow_run_cancel` → `Run canceled`
  - `workflow_run_resume` → `Run resumed`
  - `workflow_run_retry` → `Run retried`
  - `workflow_run_replay` → `Run replayed`
  - `workflow_run_requeue_event` → `Event wait requeued`
- Unknown operations must still export with a readable fallback label derived from the operation string.
- Known `changed_data` and `details` fields must populate first-class CSV columns when applicable:
  - status/run status
  - reason
  - workflow version / draft version / published version
  - step path / node path
  - action ID and version
  - source
  - workflow name and key when available
- `changed_fields` must list populated business-relevant changed fields and omit null/undefined/empty values.
- `summary` must be a short readable sentence synthesized from the event and known fields.
- `additional_details` must include safe unmapped scalar values as `key=value; key=value`.
- Arrays and objects in unmapped fields must be summarized, e.g. `warnings=2 items` or `trigger=object`, rather than stringified as JSON.
- CSV escaping must remain correct for commas, quotes, and newlines.
- JSON export must remain unchanged except for any existing redaction behavior.

### Non-functional Requirements

- Preserve the existing `EXPORT_AUDIT_LIMIT` row cap behavior.
- Preserve the current audit row ordering from `listWorkflowAuditLogsAction()`.
- Avoid adding heavyweight joins to the audit list path used by the UI table; enrichment should be part of CSV export only unless implementation naturally shares safe helpers.
- Enrichment failures from missing related records should not fail an otherwise authorized export.
- Permission and tenant validation failures must continue to fail fast.

## Data / API / Integrations

Primary files expected to change:

- `ee/packages/workflows/src/actions/workflow-runtime-v2-actions.ts`
  - Add CSV presentation helpers or call a helper module from the CSV branch of `exportWorkflowAuditLogsAction()`.
  - Add enrichment queries for actor and workflow/run context.
  - Preserve JSON branch behavior.
- Optional helper/test files under `ee/packages/workflows/src/actions/` or nearby package test locations, depending on existing test conventions.
- Existing UI callers remain:
  - `ee/server/src/components/workflow-designer/WorkflowDefinitionAudit.tsx`
  - `ee/server/src/components/workflow-designer/WorkflowRunDetails.tsx`
- Existing API routes continue to work automatically:
  - `server/src/app/api/workflow-definitions/[workflowId]/audit/export/route.ts`
  - `server/src/app/api/workflow-runs/[runId]/audit/export/route.ts`

Enrichment rules:

- Actor enrichment:
  - Query `users` for distinct non-null `user_id` values from exported logs.
  - Use `first_name`, `last_name`, and `email` where available.
  - Format actor as `First Last <email>`, `email`, `First Last`, `system`, or `Unresolved user`.
  - Keep `actor_user_id` in trailing technical columns.
- Definition export context:
  - Resolve current workflow definition for name/key/current context.
  - `workflow_id` is the scoped record ID.
  - `run_id` is blank.
- Run export context:
  - Resolve current run for `run_id`, `workflow_id`, `workflow_version`, and current `run_status`.
  - Resolve definition for `workflow_name` and `workflow_key` where available.

## Security / Permissions

- Keep `listWorkflowAuditLogsAction()` authorization and tenant-scoped record validation as the source of truth.
- CSV formatting must operate on already-redacted `changed_data` and `details` from `listWorkflowAuditLogsAction()`.
- Sensitive-looking keys and `secretRef` values must remain redacted as today.
- Missing enrichment data must not leak cross-tenant information; all enrichment queries must stay tenant-safe where tenant information is available.
- Do not lower the current workflow admin permission requirement for audit exports.

## Observability

No new observability is required for v1. Existing server errors from the export action remain sufficient. Implementation may add developer-facing tests and helper names that make formatting failures easy to diagnose.

## Rollout / Migration

- No database migration is required.
- The CSV column shape changes from the old 5-column export to the new stable business-readable export.
- Filename and content type remain unchanged.
- JSON export remains available for raw redacted rows and can be used as an escape hatch for details that CSV intentionally summarizes.
- If a downstream dependency on the old 5-column CSV is later discovered, consider adding a separate `legacy_csv` format, but do not include it in v1.

## Open Questions

- Confirm exact test framework/location for workflow package action helper tests during implementation.
- Decide during implementation whether CSV formatting helpers should live inline in `workflow-runtime-v2-actions.ts` or in a dedicated helper module for unit testing.

## Acceptance Criteria (Definition of Done)

- Definition audit CSV exports include readable events, actors, workflow context, changed fields, summaries, additional details, and trailing technical IDs.
- Run audit CSV exports include readable events, actors, workflow/run context, reasons, status, step/action metadata where present, summaries, additional details, and trailing technical IDs.
- CSV does not include raw JSON blobs for `changed_data` or `details`.
- Unknown operations and unmapped fields do not silently disappear; safe scalar details appear in `additional_details` and complex values are summarized.
- Actor enrichment displays names/emails when available and preserves actor user IDs at the end.
- Missing users or deleted workflow/run context do not crash the export.
- Permission/tenant validation behavior remains unchanged.
- JSON export still returns the full redacted rows.
- Automated tests cover representative known operations, unknown/unmapped fields, CSV escaping, redaction preservation, and enrichment fallbacks.
