# Scratchpad — Workflow Call Actions Library (Business Operations)

- Plan slug: `workflow-call-actions-library`
- Created: `2025-12-30`

## What This Is
Keep a lightweight, continuously-updated log of discoveries and decisions made while implementing this plan.

## Decisions
- (2025-12-30) Start with 18 first-party “business operations” call actions spanning ticketing, lookup, communication, scheduling, projects, time, and notes.
- (2025-12-30) Treat every action as schema-first: input/output schema + consistent error codes + consistent audit/telemetry.

## Discoveries / Constraints
- (2025-12-30) Auth/session checks can trigger DB pool exhaustion in dev if connection pools leak across hot reload; keep action execution paths short-lived and avoid unbounded parallelism.
- (2025-12-30) Workflow Runtime v2 already provides schema validation (Zod), action invocation persistence (`workflow_action_invocations`), and built-in idempotency key support (engine-provided and action-provided) with run timeline logging.
- (2025-12-30) Workflow runtime v2 worker uses the admin DB connection and relies on per-action tenant isolation; for tables with RLS policies we can use `set_config('app.current_tenant', <tenant>, true)` inside the action transaction to satisfy `current_setting('app.current_tenant')` checks.
- (2025-12-30) Workflow worker already imports server modules (e.g. `registerAccountingExportWorkflowActions`), so cross-package reuse in worker contexts is feasible when needed.
- (2025-12-30) Workflow run records do not currently capture an explicit “actor user id”; for business-operation permissions/audit attribution we can derive an actor from the published workflow version (`workflow_definition_versions.published_by`) and treat it as the service identity for workflow executions.

## Commands / Runbooks
- (2025-12-30) Validate plan files: open `PRD.md`, ensure `features.json` and `tests.json` are valid JSON arrays; keep `implemented` booleans accurate as work lands.

## Links / References
- `ee/docs/plans/2025-12-21-workflow-overhaul.md`
- `ee/docs/plans/2025-12-27-workflow-trigger-payload-mapping/PRD.md`
- `ee/docs/plans/2025-12-28-workflow-payload-contract-inference/PRD.md`

## Open Questions
- Which permission names/scopes should each action enforce (tickets vs scheduling vs time)?
- What is the canonical “schedule entry” entity in Alga PSA v2 workflows (and how do we model conflicts)?
- Which actions require idempotency guarantees on day one (create ticket, send email, create schedule, create time entry)?

## Discoveries / Constraints (continued)
- (2025-12-30) `shared/workflow/runtime/actions/registerBusinessOperationsActions.ts` imports `server/src/services/email/EmailProviderManager` for `email.send`, so `npm run build:shared` transitively typechecks some `server/src/...` files.
- (2025-12-30) To keep `build:shared` compiling without pulling `packages/product-email-domains/*` TS sources into the shared TS project (rootDir mismatch), we added a minimal type shim for `@product/email-domains/providers/ResendEmailProvider` in `shared/types/product-email-domains.d.ts`.
- (2025-12-30) Ticket “due date” is not a first-class `tickets.due_date` column; we treat due date as `ticket.attributes.due_date` for the workflow action patch surface.
- (2025-12-30) Mention notifications in Alga prefer BlockNote JSON content; `tickets.add_comment` now supports a `mentions[]` input and will wrap plain text into BlockNote JSON when mentions are provided.
- (2025-12-30) `shared` eslint currently reports a large number of pre-existing warnings/errors; running it also needs increased heap (e.g. `NODE_OPTIONS=--max-old-space-size=8192`) to avoid OOM on Node 25.
