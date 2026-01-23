# Workflow Overhaul Scratchpad

## 2025-12-21 — Initial Survey

### Docs reviewed
- `docs/AI_coding_standards.md` (general coding rules + UI rules).
- `docs/workflow/README.md` (points to current workflow system docs).
- `docs/workflow/workflow-system.md` + `docs/workflow/workflow-event-sourcing-model.md` (legacy TS runtime: action registry, event sourcing, worker, Redis streams, etc.).
- PRD: `ee/docs/plans/2025-12-21-workflow-overhaul.md` (new data-defined runtime, Envelope, structured pipeline, JSONata, registries, node types, email workflow, GUI, API, etc.).
- Checklist: `ee/docs/plans/workflow_runtime_feature_checklist.json` (all items currently false).

### Legacy runtime + email workflow code locations
- Legacy runtime core: `shared/workflow/core/workflowRuntime.ts` (TypeScriptWorkflowRuntime)
- Legacy action registry: `shared/workflow/core/actionRegistry.ts`
- Worker service: `services/workflow-worker/src/WorkflowWorker.ts`
- Legacy system email workflow (code-based): `shared/workflow/workflows/system-email-processing-workflow.ts`
- Email workflow actions (shared): `shared/workflow/actions/emailWorkflowActions.ts`
- Email workflow action registration: `shared/workflow/init/registerWorkflowActions.ts` (registers find_contact_by_email, find_ticket_by_reply_token, etc.)

### Workflow editor UI
- Existing editor components under `server/src/components/workflow-editor/*` and actions in `server/src/lib/actions/workflow-editor-actions.ts` (currently code-based definitions, not new structured pipeline).

### DB schema status
- Existing workflow tables: workflow_executions, workflow_events, workflow_action_results, etc.
- No tables yet for new runtime entities (`workflow_runs`, `workflow_run_steps`, `workflow_run_waits`, `workflow_action_invocations`), per checklist.
- System workflow registration tables exist (system_workflow_registrations, versions, event attachments).

### Observations
- Current workflow system is code-based TS workflow execution with ActionRegistry idempotency, Redis Streams, event sourcing.
- PRD requires new data-defined runtime (Envelope, NodeTypeRegistry, ActionRegistry with Zod schemas + idempotency), JSONata expression engine, structured pipeline steps, waits/retries, run history, GUI node-in-pipe designer, plus new email workflow as data.

### Next steps
- Deep read of `shared/workflow/core/workflowRuntime.ts` and related persistence models to map reuse/impact.
- Locate existing validation utilities and editor flows for potential reuse.
- Draft new schema + registry components and runtime interpreter design within repo structure (likely in `shared/workflow` + server actions + worker).
- Begin checklist execution by implementing foundational registry + schema + expression engine + persistence + runtime.


## 2025-12-21 — Runtime V2 Implementation Progress

### New runtime foundation (shared/workflow/runtime)
- Added Zod-based runtime types + workflow definition schema + envelope schema in `shared/workflow/runtime/types.ts`.
- Implemented SchemaRegistry + NodeTypeRegistry + ActionRegistry (V2) under `shared/workflow/runtime/registries/`.
- JSONata expression engine with allowlist + timeout/output size checks in `shared/workflow/runtime/expressionEngine.ts`.
- Expression resolver supports recursive Expr objects and wraps errors as `ExpressionError`.
- Redaction utilities with JSON pointer masking + secretRef masking in `shared/workflow/runtime/utils/redactionUtils.ts`.
- Assignment utilities for dot-path + JSON pointer updates in `shared/workflow/runtime/utils/assignmentUtils.ts`.
- Publish validation (`shared/workflow/runtime/validation/publishValidation.ts`) validates WorkflowDefinition shape, step IDs, node types, action references, configs, and Exprs (plus best-effort assign path warnings).

### Runtime interpreter + persistence
- Implemented deterministic interpreter in `shared/workflow/runtime/runtime/workflowRuntimeV2.ts`:
  - Uses `workflow_runs`, `workflow_run_steps`, `workflow_run_waits`, `workflow_action_invocations`, `workflow_run_snapshots`.
  - Persists nodePath after each step; supports RUNNING/WAITING/SUCCEEDED/FAILED/CANCELED.
  - Retry scheduling with backoff + jitter to `workflow_run_waits`.
  - Event waits + timeout handling (TimeoutError) + try/catch + per-item forEach error handling.
  - Idempotency enforced via unique `(action_id, action_version, idempotency_key)` with cached outputs.
  - OutputMapping for `control.callWorkflow` now maps child run snapshots into parent env.

### Node types (registry)
- Implemented required node types in `shared/workflow/runtime/nodes/registerDefaultNodes.ts`:
  - `state.set`, `event.wait`, `transform.assign`, `action.call`, `email.parseBody`, `email.renderCommentBlocks`, `human.task`.
- Email node fallbacks in `shared/workflow/runtime/nodes/utils/emailNodes.ts`.

### Action registry (email workflow)
- Registered Zod-schemas for required email actions in `shared/workflow/runtime/actions/registerEmailWorkflowActions.ts`:
  - parse_email_reply, find_ticket_by_reply_token, find_ticket_by_email_thread, convert_html_to_blocks, create_comment_from_email, process_email_attachment, find_contact_by_email, resolve_inbound_ticket_defaults, create_ticket_from_email, create_human_task_for_email_processing_failure, send_ticket_acknowledgement_email.

### Schema registry
- Email payload schema `payload.EmailWorkflowPayload.v1` registered in `shared/workflow/runtime/schemas/emailWorkflowSchemas.ts` and `shared/workflow/runtime/init.ts`.

### DB + migrations
- Added migration `server/migrations/20251221090000_create_workflow_runtime_v2_tables.cjs` creating:
  - workflow_definitions, workflow_definition_versions, workflow_runs, workflow_run_steps, workflow_run_waits, workflow_action_invocations, workflow_run_snapshots, workflow_runtime_events.
- Added migration `server/migrations/20251221103000_register_email_workflow_runtime_v2.cjs` to seed draft + version for new JSON email workflow.

### Email workflow (data-defined)
- Draft JSON definition in `shared/workflow/runtime/workflows/email-processing-workflow.v1.json` (structured pipeline, no initial event.wait per instruction).
- Covers reply-token threading, fallback to threading headers, new ticket creation, attachment processing, human task on failure.

### API endpoints (server)
- Added Next.js API routes:
  - `/api/workflow-definitions` (list/create)
  - `/api/workflow-definitions/{id}/{version}` (get/update)
  - `/api/workflow-definitions/{id}/{version}/publish`
  - `/api/workflow-runs` (start)
  - `/api/workflow-runs/{runId}` (status)
  - `/api/workflow-runs/{runId}/steps`
  - `/api/workflow-runs/{runId}/cancel`
  - `/api/workflow-runs/{runId}/resume`
  - `/api/workflow/registry/nodes`, `/api/workflow/registry/actions`, `/api/workflow/registry/schemas/{schemaRef}`
  - `/api/workflow/events` (submit + list; submit now transactional/atomic).

### Worker / Scheduler
- Added `services/workflow-worker/src/v2/WorkflowRuntimeV2Worker.ts` polling:
  - due retry waits + timeout waits + runnable runs.
- Wired worker start/stop in `services/workflow-worker/src/index.ts`.

### Package updates
- Added `jsonata` + `zod-to-json-schema` to `shared/package.json`.
- Added `zod-to-json-schema` to `server/package.json`.
- Added shared exports for `./workflow/runtime`.

### Known gaps / to-do
- GUI node-in-pipe designer + run viewer not implemented.
- No expression inline validation in UI yet.
- No tests added yet for runtime, registries, expression engine.
- Event wait start step removed per instruction; checklist item for 10s wait remains false.
- HTML->blocks fallback in initial comment not wired into workflow definition.


## 2025-12-21 - Server actions first-class for workflow runtime V2
- Added `server/src/lib/actions/workflow-runtime-v2-actions.ts` with server actions for all V2 definition, publish, run, registry, schema, and event operations (server actions are now the primary entry point).
- Added shared schemas in `server/src/lib/actions/workflow-runtime-v2-schemas.ts` and API error helper `server/src/lib/api/workflowRuntimeV2Api.ts`.
- Updated workflow V2 API routes to delegate to server actions and use the API error helper:
  - `server/src/app/api/workflow-definitions/route.ts`
  - `server/src/app/api/workflow-definitions/[workflowId]/[version]/route.ts`
  - `server/src/app/api/workflow-definitions/[workflowId]/[version]/publish/route.ts`
  - `server/src/app/api/workflow-runs/route.ts`
  - `server/src/app/api/workflow-runs/[runId]/route.ts`
  - `server/src/app/api/workflow-runs/[runId]/steps/route.ts`
  - `server/src/app/api/workflow-runs/[runId]/cancel/route.ts`
  - `server/src/app/api/workflow-runs/[runId]/resume/route.ts`
  - `server/src/app/api/workflow/registry/nodes/route.ts`
  - `server/src/app/api/workflow/registry/actions/route.ts`
  - `server/src/app/api/workflow/registry/schemas/[schemaRef]/route.ts`
  - `server/src/app/api/workflow/events/route.ts`

## 2025-12-21 - PRD aligned with server-action-first pattern
- Updated PRD section 6.1 to state server actions are first-class and API routes are thin delegates.
- Expanded section 11 with a Server Actions table and labeled API surfaces as delegating layers.
- Clarified publish response applies to server actions and endpoints.

## 2025-12-21 — Tests + Event Triggers + Redaction + Admin Resume

### Test plan implementation
- All 220 backend test plan items now have matching Vitest tests; `ee/docs/plans/workflow_runtime_backend_test_plan.json` updated to `implemented=true` for all items.
- Added new integration suites:
  - `server/src/test/integration/workflowRuntimeV2.eventTrigger.integration.test.ts` (event-triggered runs, payload validation, audit events).
  - `server/src/test/integration/workflowRuntimeV2.redaction.integration.test.ts` (snapshot redaction, action invocation redaction, snapshot truncation, retention).
- Added new E2E suite: `server/src/test/e2e/workflowRuntimeV2.e2e.test.ts` covering publish/run, event triggers, waits/resume/timeouts, retries, idempotency, cancel/resume, and email workflow paths.
- Updated existing tests:
  - `server/src/test/integration/workflowRuntimeV2.control.integration.test.ts` (retry/catch behavior + exact test names).
  - `server/src/test/integration/workflowRuntimeV2.email.integration.test.ts` (use beforeEach to avoid DB resets wiping shared runs).
  - `server/src/test/integration/workflowRuntimeV2.publish.integration.test.ts` (resume action now completes event waits).

### Runtime/Actions updates driven by tests
- `shared/workflow/runtime/runtime/workflowRuntimeV2.ts`: respect `RetryPolicy.maxAttempts` when deciding to schedule retries.
- `server/src/lib/actions/workflow-runtime-v2-actions.ts`: admin resume now resolves one WAITING wait, sets resume_event_name to the wait event, clears resume payload, and executes the run (enables "resume to completion" E2E).

### Redaction + retention checks
- Added integration coverage for redacted snapshots + action invocations, snapshot truncation, and retention pruning via event wait resume.

### PRD updates
- Added terminology section + expression best-practices subsection in `ee/docs/plans/2025-12-21-workflow-overhaul.md`.

### Feature checklist adjustments
- Updated `ee/docs/plans/workflow_runtime_feature_checklist.json` for backend/runtime items (goals, validation pipeline, events, tests, idempotency patterns).
- Remaining false items are GUI designer + UI workflow run viewer + rollout tasks (parallel-run + cutover) and "tenant_id log context".

### Dev environment setup (Alga Dev Env + Test Env skill)
- Ports chosen via detect_ports (env #8): app 3007, postgres 5439, redis 6386, hocuspocus 1241, pgbouncer 6439.
- Secrets regenerated into `./secrets` via `generate_secrets.py`.
- Updated `server/.env` with PROJECT_NAME=workflow_overhaul_env8 and new ports.
- Docker dev build started with `docker compose -f docker-compose.yaml -f docker-compose.base.yaml -f docker-compose.ee.yaml --env-file server/.env build server redis workflow-worker setup`.
  - Build emits warnings about unset env vars (ITERATION, HOST, etc.) but proceeds.

### Notable findings
- Event waits do not create snapshots while waiting; retention pruning requires a later snapshot (handled via resume).
- Admin resume previously re-waited; now resolves waits and resumes using wait event name to allow completion.


## 2025-12-21 — Dev env fixes + stack up
- `docker compose up -d` initially failed due to missing secrets `secrets/ninjaone_client_id` + `secrets/ninjaone_client_secret`; created empty files to satisfy bind mounts.
- `docker compose up -d` then hit host port conflict on pgbouncer (6432). Updated `server/.env` to use internal ports for container-to-container connections and EXPOSE_* for host mappings:
  - Internal: DB 5432, Redis 6379, Hocuspocus 1234, PgBouncer 6432.
  - Exposed: DB 5439, Redis 6386, Hocuspocus 1241, PgBouncer 6439, Server 3007.
- Brought stack down/up with new env; setup now connects via pgbouncer 6432, migrations + seeds completed, and all containers started successfully.

## 2025-12-21 — Runtime test fixes (control integration)

### Runtime fixes
- Fixed expression normalization to handle nested allowlisted functions (non-consuming lookahead). This resolved `coalesce` / `append` ExpressionError in forEach body assignments.
- Corrected path stack containerPath handling for nested blocks in `resolveStepAtPath` so forEach loops resume correctly across body steps.
- Cleared `lease_owner` + `lease_expires_at` whenever runs enter WAITING (event waits + retry scheduling) to allow resume by other workers.
- `control.callWorkflow` now checks child run status after inline execution and throws `ActionError` if child failed (enables propagation + retry scheduling).
- Idempotency keys are now tenant-scoped by prefixing with `tenantId` when present.

### Test helper updates
- `actionCallStep` helper now accepts `retry` and sets it on the step.
- Stale-lease test setup uses tenant-scoped idempotency keys (`${tenantId}:fixed|stale`).

### Test expectation fixes
- `control.return inside control.if` now asserts the downstream action never runs (instead of expecting only 1 step record).
- WAITING resume test now checks `definition_step_id === 'state-1'` (step_path is index-based).

### Tests run
- `npx vitest --run server/src/test/integration/workflowRuntimeV2.control.integration.test.ts -t "control.return inside control.if|WAITING run resumes"` (both tests pass after updates).

### Open items
- None in control integration suite after fixes; full suite expected to pass (only earlier failures were expectation mismatches).

## 2025-12-22 — Workflow UI tests (Runs detail) + env note

### Environment
- Confirmed correct stack: `workflow_overhaul_env8` (workflow-overhaul/workflow_overhaul_env8).

### Playwright runs-detail suite fixes
- `ee/server/src/__tests__/integration/workflow-designer-runs.playwright.test.ts`: `createWorkflowAuditLog` now normalizes empty userId → null and uses a transaction to set `app.current_tenant` + insert on the same connection (avoids `invalid input syntax for type uuid: ""` from audit log insert + trigger).

### Tests executed (all passing after fix)
- `run logs tab filters by search and level`
- `run logs load more appends additional entries`
- `run audit logs tab loads entries and supports export`
- `run audit logs load more appends additional entries`

### Notes
- Audit log failures were due to `set_config` being connection-scoped; pooling meant the insert ran without `app.current_tenant` set.

## 2025-12-21 — Workflow Designer Playwright UI tests (batch 2)

### UI test coverage added
- `ee/server/src/__tests__/page-objects/WorkflowDesignerPage.ts`: added workflow step locators + helpers (`selectWorkflowByName`, `selectStepById`) and settings panel locators.
- `ee/server/src/__tests__/integration/workflow-designer-basic.playwright.test.ts`: added 8 tests:
  - Read-only users see the read-only message when selecting steps.
  - Workflow selection loads payload schema ref and trigger event name from stored definition.
  - Editing workflow name, version, description updates the draft inputs.
  - Trigger input accepts a non-empty event name and clears to empty.
- Read-only test permissions now include `workflow:read` to allow workflow list load.
- `ee/docs/plans/workflow_ui_test_plan.json`: marked 8 additional items as implemented.

### Test run
- Ran `npx playwright test src/__tests__/integration/workflow-designer-basic.playwright.test.ts --project=chromium` with Playwright DB port 5437; **13 tests passed**.

### Observations
- Read-only users trigger registry server actions that return 403 (expected with current UI); UI shows toast but tests still pass.
- Occasional `ECONNRESET` / `Error: aborted` logs during navigation and repeated `NotificationAccumulator` Redis auth warnings (existing noise; did not fail tests).

## 2025-12-21 — Full workflow runtime v2 test run (unit + integration + e2e)

### Fixes applied before full run
- Email workflow integration expectations updated:
  - Attachment idempotency key assertion now checks both attachment ids irrespective of call order (non-deterministic iteration).
  - `resolve_inbound_ticket_defaults` expectation updated to assert input object `{ tenant, providerId }` rather than positional args.

### Tests run
- `DB_HOST=localhost DB_PORT=5437 DB_USER_ADMIN=postgres DB_USER_SERVER=app_user DB_PASSWORD_ADMIN=$(cat secrets/postgres_password) DB_PASSWORD_SERVER=$(cat secrets/db_password_server) npx vitest --run server/src/test/unit/workflowRuntimeV2.unit.test.ts server/src/test/integration/workflowRuntimeV2.*.test.ts server/src/test/e2e/workflowRuntimeV2.e2e.test.ts`

### Results
- All tests passed: 221/221 across unit, integration, and e2e suites.
- Known DB log warnings during failure-path tests (invalid uuid like `provider-1` / `tenant-...`) are expected in negative-path coverage and did not fail.
- `workflow_runtime_backend_test_plan.json` already shows all 220 tests marked `implemented: true` (no update needed).

### Checklist status
- `workflow_runtime_feature_checklist.json` still has 22 items marked `implemented: false` (appears to be GUI/editor-focused items such as inline syntax validation). Backend checklist items appear complete.


## 2025-12-21 — Workflow Designer (Section 10) Progress

### Implemented UI (EE)
- Added `ee/server/src/components/workflow-designer/WorkflowDesigner.tsx` with node-in-pipe canvas, nested blocks, and right-side config panel.
- Integrated designer as the workflow entry point by exporting it from `packages/product-workflows/ee/entry.tsx` and `packages/product-workflows/ee/entry.ts`.
- Node palette loads from `/api/workflow/registry/nodes` with search; steps insert into selected pipe.
- Drag/drop reorder within pipes and move between nested pipes via `@hello-pangea/dnd`.
- Config panel generates forms from node config JSON Schema with required-field warnings and JSON fallback editors.
- Expression editor supports field picker insertion (payload/vars/meta/error) and local JSONata syntax validation.
- Publish workflow triggers server validation and surfaces publish errors with step breadcrumb context.

### Remaining
- Run list + run detail viewer (status filters, timelines, snapshots, logs).
- Admin resume/cancel UI actions.
- Redacted snapshot rendering in UI.


## 2025-12-21 — Operational/Observability Expansion

### PRD updates
- Added Section 14 (Operational Support, Observability, and Governance) to the PRD with run list, run detail, logging, audit, RBAC, retention/export, metrics/alerts, ops controls, event observability, and performance targets.

### Checklist updates
- Appended detailed operational/observability features (run history, logs, audit, RBAC, retention, metrics, alerting, ops controls, event observability, performance) to `workflow_runtime_feature_checklist.json`.

### Run list implementation start
- Added workflow run list API (GET `/api/workflow-runs`) via `listWorkflowRunsAction` with filters, pagination, and workflow name join.
- Added run list UI tab with filters and table in `ee/server/src/components/workflow-designer/WorkflowRunList.tsx` and wired into `WorkflowDesigner` tabs.
- Marked checklist item for run list view as implemented.

### Run details implementation
- Added run details panel with step timeline, snapshot viewer, action invocation logs, and wait summary.
- Added admin resume/cancel UI actions with confirmation dialogs.
- Added UI-side masking for sensitive keys (secret/token/password/etc.) before rendering JSON.
- Updated run steps API payload to include invocations + waits.
- Marked checklist items for run details, snapshots/logs, admin actions, and redaction as implemented.

### Operational iteration (Section 14)
- Added run summary endpoint (`GET /api/workflow-runs/summary`) with counts by status and filters.
- Added quick time-range chips (last 24h/7d) and status count badges to the run list UI.
- Expanded run detail wait history to show event name, correlation key, timeouts, and resolution timestamps.
- Marked §14 items for timeline display, wait history, correlation fields, and quick filters as implemented.

## 2025-12-21 — Operational Section Progress (continued)

### Run list enhancements
- Added tenant context column (shown when multiple tenants appear) and correlation key search (via wait key join).
- Implemented bulk select with resume/cancel actions and confirmation dialogs.

### Run detail enhancements
- Added workflow metadata (workflow id/version/trigger/run id) and richer error display.
- Step details now include status/attempt/timestamps, error category/at, and next retry.
- Added payload/vars/meta/error/raw tabs with redaction notice; action invocation redaction notice.
- Added timeline filters (status + node type), collapse nested blocks toggle, and step deep-linking via `?step=`.

### API shim alignment (server actions first)
- Workflow designer UI now uses server actions directly for definitions, registries, runs, logs, audits, events, exports, and admin operations.
- Export logic moved into server actions (runs/events/audits/logs); API routes are thin shims over actions.
- Added workflow run log export action and API shim for external access.

### Run log observability
- Added `workflow_run_logs` persistence + model, runtime log hooks (steps, waits, action invocations, retries, resume/timeouts).
- Implemented log APIs (`/api/workflow-runs/{runId}/logs`) with pagination + CSV export.
- Added run log viewer with level filters, search, and export in run details.
- Action invocation cards now show input/output size and truncation markers in UI.

### Audit trail
- Added audit logging for workflow definition create/update/publish and run cancel/resume (with reasons).
- Added audit APIs for workflows and runs plus CSV export routes.
- Added Audit tab for workflow definitions and audit trail section in run details.

### RBAC + workflow metadata
- Added workflow permissions (view/publish/admin) migration and wired RBAC checks across workflow actions.
- Added workflow definition metadata (system/visible/paused/concurrency/auto-pause thresholds) + UI settings + metadata endpoint.
- Enforced system workflow edit protection and visibility filtering; hid admin controls based on permissions.

## 2025-12-21 — Operational Section Progress (ops controls + events)

### Run controls + dead-letter
- Added retry/replay/requeue admin actions with required reasons, audit log entries, and run log markers.
- New API routes: `/api/workflow-runs/{runId}/retry`, `/replay`, `/requeue`, plus `/api/workflow-runs/dead-letter`.
- Dead-letter queue UI (retries threshold + run detail panel) added as a new tab.
- Added run list CSV export and run detail JSON export with redactions.

### Event observability
- Added event tracking fields (matched_run_id, matched_wait_id, error_message, created_at index) and lookup index migration.
- Event ingestion now records match metadata, error messages, and processed timestamps.
- Event list UI with filters, status badges, payload preview (redacted), and event detail panel linking to matched run.
- Event summary endpoint + UI badges for matched/unmatched/error counts.
- Event export endpoints (CSV/JSON) wired to the event list filters.

### Performance + indexing
- Added index on workflow_runs (workflow_id, status, updated_at) and workflow_run_steps (run_id, step_id).
- Enforced per-tenant run start rate limits and max payload size checks in server action.

## 2025-12-21 — Runtime V2 fixes + test stabilization

### Runtime/action changes
- `shared/workflow/runtime/runtime/workflowRuntimeV2.ts`
  - Retry scheduling now stops when `attempt >= maxAttempts`.
  - `control.forEach` now treats non-array items as `ValidationError`.
  - `control.callWorkflow` now checks child run status and throws `ActionError` on failure (enables parent failure + retry policy).
  - Idempotency keys are tenant-scoped (prefix with `tenantId:` unless already prefixed).
  - `acquireRunnableRun` uses JS time (`new Date().toISOString()`) for stale-lease comparison for better test consistency.
  - Snapshot retention pruning added (default 30 days, env override `WORKFLOW_RUN_SNAPSHOT_RETENTION_DAYS`).
- `server/src/lib/actions/workflow-runtime-v2-actions.ts`
  - `startWorkflowRunAction` now uses latest published version when version omitted and validates payload against schema registry.
  - `submitWorkflowEventAction` now resumes both `event` and `human` waits.
  - `listWorkflowEventsAction` accepts `undefined` input (defaults to `{}`) and still returns `{ events, nextCursor }`.
  - `resumeWorkflowRunAction` now records admin resume events and re-stores `resume_event_payload` after execution (admin override metadata persists).
- `services/workflow-worker/src/v2/WorkflowRuntimeV2Worker.ts`
  - Scheduler skips retries/timeouts for CANCELED runs; marks waits CANCELED instead of resuming.
- `shared/workflow/runtime/nodes/registerDefaultNodes.ts`
  - Admin resume bypasses human-task validation when resume event name is `ADMIN_RESUME` or payload includes `__admin_override`.

### Test plan + test updates
- Updated admin-resume test plan wording to reference admin override metadata.
- `workflowRuntimeV2.control.integration.test.ts` now expects `listWorkflowEventsAction()` to return `{ events }`.
- Increased `beforeAll` timeout for `workflowRuntimeV2.email.integration.test.ts` to 180s to avoid hook timeouts on heavy DB resets.
- Marked checklist item “Persist sanitized envelope snapshot per checkpoint and cap size/retention” as implemented.

### Test runs
- Control + publish integration suites now pass when run together.
- Full workflow runtime suite (`unit + integration + e2e`) still fails in this environment due to Knex connection pool timeouts during repeated `createTestDbConnection()` calls:
  - Errors: `Knex: Timeout acquiring a connection` during DB recreation.
  - Cascading failures in multiple workflow runtime test files and e2e runtime suite.
  - Suggest running workflow runtime test files in smaller batches or increasing DB connection capacity/timeout when running the full suite.


## 2025-12-21 Playwright UI test plan
- Created `ee/docs/plans/workflow_ui_test_plan.json` with 207 Playwright-focused UI tests covering Workflow Designer, Runs, Events, Dead Letter, and Audit tabs.
- Tests are framed as user-facing behavior with mockable non-target dependencies, and include 8 E2E scenarios for end-to-end UI flows.
- Plan aligns with the workflow overhaul UI (node-in-pipe designer, run viewer, event list) surfaced at `/msp/workflows` (EE uses WorkflowDesigner via `@product/workflows/entry`).

## 2025-12-21 — Playwright UI tests (batch 3)
- Fixed workflow list count assertion regex (removed escaped backslashes) so it matches digits.
- Added `workflow:read` to `MANAGE_PERMISSIONS` in `workflow-designer-basic.playwright.test.ts` so Runs tab data can load (listWorkflowRunsAction requires read).
- Ran Playwright workflow designer suite after fixes: `ee/server/src/__tests__/integration/workflow-designer-basic.playwright.test.ts` now passes (17/17).
- Marked UI test plan items implemented: workflow list count, admin Dead Letter/Audit tabs + empty states, settings panel visibility, Runs/Events/Dead Letter/Audit empty states.
- Observed recurring logs during tests: registry 401/403 on aborted requests, Redis NOAUTH notifications, ECONNRESET “aborted” logs; tests still pass.

## 2025-12-22 — Playwright UI tests (batch 4)
- Added new workflow designer control block coverage in `ee/server/src/__tests__/integration/workflow-designer-blocks.playwright.test.ts`:
  - Pipe selector root + nested pipe updates (If THEN/ELSE).
  - control.forEach BODY pipe + config fields + Block badge.
  - control.tryCatch TRY/CATCH + capture error field.
  - control.return helper text.
  - control.callWorkflow input/output mapping add/edit/remove flows + empty state.
- Fixed selector failures by targeting stable IDs instead of labels (Input labels don’t use `htmlFor`).
- Final run: `workflow-designer-blocks.playwright.test.ts` passes (7/7). Observed recurring server logs: Redis NOAUTH and occasional `ECONNRESET` + one `Unauthorized` log from `listWorkflowRegistryActionsAction` during setup; tests still green.
- Marked 19 UI test plan items implemented (control blocks, mapping editor behaviors, pipe selector updates, return helper text, Block badge).

## 2025-12-22 — Playwright UI tests (batch 5)
- Updated workflow permission model to match PRD/test plan: manage no longer implies publish/admin.
  - `ee/server/src/components/workflow-designer/WorkflowDesigner.tsx`: `canPublish` now requires `workflow:publish` (or admin), `canAdmin` requires `workflow:admin`, `canManage` allows manage/admin.
  - `server/src/lib/actions/workflow-runtime-v2-actions.ts`: `requireWorkflowPermission` fallback now allows admin for manage/publish; removed manage→publish fallback. `listWorkflowRegistryNodesAction`/`listWorkflowRegistryActionsAction` now require `read` (not manage).
- Expanded `WorkflowDesignerPage` helpers (setName, selectWorkflowByName, selectStepById, clickSaveDraft) to support new tests.
- Fixed control test expectations to check active workflow selection after tab switches (switch to Runs then back to Designer).
- Ran `workflow-designer-controls.playwright.test.ts` with env to avoid DB auth mismatch when Playwright forces admin credentials:
  - Command: `PW_REUSE=false PLAYWRIGHT_APP_PORT=3300 PLAYWRIGHT_DB_PORT=5437 SECRET_READ_CHAIN=env SECRET_WRITE_PROVIDER=env DB_PASSWORD_ADMIN=$(cat ../../secrets/postgres_password) PLAYWRIGHT_DB_ADMIN_PASSWORD=$(cat ../../secrets/postgres_password) DB_PASSWORD_SERVER=$(cat ../../secrets/postgres_password) npx playwright test src/__tests__/integration/workflow-designer-controls.playwright.test.ts`
  - Result: 4/4 passing (manage-only save vs publish, publish-only, active selection persists across tabs, switching workflows clears config panel).
  - Noted recurring server logs: Redis NOAUTH and occasional ECONNRESET aborted requests (no test failures).

## 2025-12-22 — Playwright UI tests (batch 6)
- Added workflow designer settings coverage in `ee/server/src/__tests__/integration/workflow-designer-controls.playwright.test.ts`:
  - System workflow settings hidden for non-admin.
  - System workflow settings visible for admin.
- Added workflow list/metadata coverage in `ee/server/src/__tests__/integration/workflow-designer-basic.playwright.test.ts`:
  - Workflow list shows total count and buttons.
  - Selecting a workflow loads draft metadata (Inbound Email Processing fields).
  - Version field accepts numeric input.
  - Clearing trigger event name removes trigger from draft.
  - Added cleanup for created workflows (delete from `workflow_definitions`).
- Fixed list count assertion to poll until label count matches button count to avoid timing flakiness.
- Ran Playwright subset (basic + controls) with DB env overrides to keep admin creds aligned:
  - Command: `PW_REUSE=false PLAYWRIGHT_APP_PORT=3300 PLAYWRIGHT_DB_PORT=5437 SECRET_READ_CHAIN=env SECRET_WRITE_PROVIDER=env DB_PASSWORD_ADMIN=$(cat ../../secrets/postgres_password) PLAYWRIGHT_DB_ADMIN_PASSWORD=$(cat ../../secrets/postgres_password) DB_PASSWORD_SERVER=$(cat ../../secrets/postgres_password) npx playwright test src/__tests__/integration/workflow-designer-basic.playwright.test.ts src/__tests__/integration/workflow-designer-controls.playwright.test.ts`
  - Result: 21/21 passing.
- Noted recurring logs during run (no test failures): Redis NOAUTH notification accumulator, `ECONNRESET` aborted requests, occasional `Unauthorized` errors from registry actions when non-admin sessions hit registry endpoints.

## 2025-12-22 — Playwright UI tests (batch 7)
- Added workflow settings tests in `ee/server/src/__tests__/integration/workflow-designer-controls.playwright.test.ts`:
  - Settings toggles update draft values (Visible, Paused), concurrency accepts numeric/empty, auto-pause toggles enable failure inputs.
  - Save Settings persists metadata overrides; verified UI state after reload and DB values.
- Added helper `createSavedWorkflow` in `workflow-designer-controls.playwright.test.ts` for reuse.
- Updated settings UI so failure threshold/min inputs are disabled when auto-pause is off:
  - `ee/server/src/components/workflow-designer/WorkflowDesigner.tsx` now passes `disabled={!metadataDraft.autoPauseOnFailure}` to both inputs.
- Ran controls suite with DB env overrides:
  - Command: `PW_REUSE=false PLAYWRIGHT_APP_PORT=3300 PLAYWRIGHT_DB_PORT=5437 SECRET_READ_CHAIN=env SECRET_WRITE_PROVIDER=env DB_PASSWORD_ADMIN=$(cat ../../secrets/postgres_password) PLAYWRIGHT_DB_ADMIN_PASSWORD=$(cat ../../secrets/postgres_password) DB_PASSWORD_SERVER=$(cat ../../secrets/postgres_password) npx playwright test src/__tests__/integration/workflow-designer-controls.playwright.test.ts`
  - Result: 12/12 passing.
- Recurring logs during run (no test failures): Redis NOAUTH notification accumulator, ECONNRESET aborted requests, registry Unauthorized logs during non-admin sessions.

## 2025-12-22 — Playwright UI tests (batch 8)
- Added workflow persistence + palette search coverage in `ee/server/src/__tests__/integration/workflow-designer-basic.playwright.test.ts`:
  - Save draft persists metadata + steps after reload (verifies step label and id).
  - Palette search filters nodes by id.
- Marked UI test plan items implemented for save draft persistence and palette search (plus related helper-text/step label items already covered).
- Ran basic suite with DB env overrides:
  - Command: `PW_REUSE=false PLAYWRIGHT_APP_PORT=3300 PLAYWRIGHT_DB_PORT=5437 SECRET_READ_CHAIN=env SECRET_WRITE_PROVIDER=env DB_PASSWORD_ADMIN=$(cat ../../secrets/postgres_password) PLAYWRIGHT_DB_ADMIN_PASSWORD=$(cat ../../secrets/postgres_password) DB_PASSWORD_SERVER=$(cat ../../secrets/postgres_password) npx playwright test src/__tests__/integration/workflow-designer-basic.playwright.test.ts`
  - Result: 13/13 passing.
- Noted recurring server logs during run (no test failures): Redis NOAUTH notification accumulator, ECONNRESET aborted requests, and intermittent workflow runtime action errors (401/403/404) during registry/schema fetches.

## 2025-12-22 — Playwright UI tests (batch 9)
- Added empty-list state coverage in `ee/server/src/__tests__/integration/workflow-designer-basic.playwright.test.ts`:
  - New snapshot/restore helpers for workflow_definitions + workflow_definition_versions.
  - Test asserts 0 workflows, no workflow buttons, Save Draft/Publish disabled, empty metadata fields, and workflow settings not shown.
- Marked UI plan items implemented: empty workflow list, save draft disabled (no active definition), publish disabled (no active definition), save settings disabled when workflow id missing.
- Ran basic suite with DB env overrides:
  - Command: `PW_REUSE=false PLAYWRIGHT_APP_PORT=3300 PLAYWRIGHT_DB_PORT=5437 SECRET_READ_CHAIN=env SECRET_WRITE_PROVIDER=env DB_PASSWORD_ADMIN=$(cat ../../secrets/postgres_password) PLAYWRIGHT_DB_ADMIN_PASSWORD=$(cat ../../secrets/postgres_password) DB_PASSWORD_SERVER=$(cat ../../secrets/postgres_password) npx playwright test src/__tests__/integration/workflow-designer-basic.playwright.test.ts`
  - Result: 14/14 passing.
- Recurring logs during run (no test failures): Redis NOAUTH notification accumulator, ECONNRESET aborted requests, intermittent workflow runtime action 401/404 noise.

## 2025-12-22 — Playwright UI tests (batch 10)
- Fixed `WorkflowDesignerPage.saveDraft()` to wait for the Save Draft button to be enabled (avoids timeout when button text stays “Saving...” longer than default wait).
- Adjusted forEach on-item-error selection/assertion to target the combobox role selector to avoid strict-mode failures from duplicate IDs.
- Reran `workflow-designer-basic.playwright.test.ts` with DB env overrides:
  - Command: `PW_REUSE=false PLAYWRIGHT_APP_PORT=3300 PLAYWRIGHT_DB_PORT=5437 SECRET_READ_CHAIN=env SECRET_WRITE_PROVIDER=env DB_PASSWORD_ADMIN=$(cat ../../secrets/postgres_password) PLAYWRIGHT_DB_ADMIN_PASSWORD=$(cat ../../secrets/postgres_password) DB_PASSWORD_SERVER=$(cat ../../secrets/postgres_password) npx playwright test src/__tests__/integration/workflow-designer-basic.playwright.test.ts`
  - Result: 18/18 passing.
- Recurring logs during run (no test failures): Redis NOAUTH notification accumulator, ECONNRESET aborted requests, intermittent workflow action 401/403/404 noise.

## UI tests batch 5 (expressions)
- Added Playwright tests for expression field + picker in `ee/server/src/__tests__/integration/workflow-designer-expressions.playwright.test.ts`.
- Covered: field picker roots, insert field into expression, append to existing expression, invalid syntax styling + clears when valid, multi-line, and empty input handling.
- Locator stability: Radix Select options were flaky with role selectors; switched assertions to `listbox.toContainText(...)` with longer timeout.
- Latest run: `workflow-designer-expressions.playwright.test.ts` passes (6/6). Still seeing benign `ECONNRESET` + `NOAUTH` log noise during runs.

## 2025-12-22 — Playwright UI tests (batch 11: basic + blocks re-run)
- Re-ran `workflow-designer-basic` + `workflow-designer-blocks` after adding unauth redirect + pipe insertion tests.
- Had to move Playwright dev server to port 3301 because 3300 was in use.
  - Command: `PW_REUSE=false PLAYWRIGHT_APP_PORT=3301 PLAYWRIGHT_DB_PORT=5437 SECRET_READ_CHAIN=env SECRET_WRITE_PROVIDER=env DB_PASSWORD_ADMIN=$(cat ../../secrets/postgres_password) PLAYWRIGHT_DB_ADMIN_PASSWORD=$(cat ../../secrets/postgres_password) DB_PASSWORD_SERVER=$(cat ../../secrets/postgres_password) npx playwright test src/__tests__/integration/workflow-designer-basic.playwright.test.ts src/__tests__/integration/workflow-designer-blocks.playwright.test.ts`
- Result: **27/27 passed**.
- Noisy server logs persisted (expected / non-failing): Redis `NOAUTH` notification accumulator, occasional `ECONNRESET` aborted requests, and intermittent 401/403/404 errors from workflow registry/schema actions during setup.

## 2025-12-22 — Playwright UI tests (batch 12: control blocks drag/drop)
- Added nested-pipe drag fallback + selectors:
  - `ee/server/src/components/workflow-designer/WorkflowDesigner.tsx`: track hovered pipe via `data-pipe-path` + global mousemove when dragging; add `data-step-id` to top-level draggable wrappers for reliable step queries.
  - `ee/server/src/__tests__/integration/workflow-designer-blocks.playwright.test.ts`: `getStepIdsIn` now reads direct `[data-step-id]` children (avoids nested pipe leakage).
  - `ee/server/src/__tests__/page-objects/WorkflowDesignerPage.ts`: wait for New Workflow button visibility before clicking.
- Reran `workflow-designer-blocks` full suite with DB env overrides:
  - Command: `PW_REUSE=false PLAYWRIGHT_APP_PORT=3301 PLAYWRIGHT_DB_PORT=5437 SECRET_READ_CHAIN=env SECRET_WRITE_PROVIDER=env DB_PASSWORD_ADMIN=$(cat ../../secrets/postgres_password) PLAYWRIGHT_DB_ADMIN_PASSWORD=$(cat ../../secrets/postgres_password) DB_PASSWORD_SERVER=$(cat ../../secrets/postgres_password) npx playwright test src/__tests__/integration/workflow-designer-blocks.playwright.test.ts`
  - Result: **10/10 passed** (1.3m).
- Still seeing noisy logs during runs (non-failing): Redis `NOAUTH` notification accumulator, occasional `ECONNRESET` aborted requests, and intermittent 401/403/404 errors from workflow registry/schema actions.

## 2025-12-22 — Env alignment
- Confirmed the correct dev stack for this work is `workflow-overhaul` / `workflow_overhaul_env8`.
- Updated `server/.env` to align ports + names with env8 (app 3007, pg 5439, redis 6386, hocuspocus 1241, pgbouncer 6439).

## 2025-12-22 — Playwright UI tests (batch 13: action.call + publish)
- Confirmed active stack is `workflow-overhaul/workflow_overhaul_env8`.
- UI change: moved “Available actions: X” display into `StepConfigPanel` for `action.call` steps so it’s always visible regardless of schema title logic.
- Added `workflow-designer-publish.playwright.test.ts` and new action.call config tests in `workflow-designer-config.playwright.test.ts`.
- Tests added:
  - action.call shows available actions count
  - action.call config args/saveAs/idempotencyKey persist after save
  - publish without saving shows toast
  - publish failure shows error cards + breadcrumbs + error badge
  - publish warnings show warning badge count
- Ran with env8 DB overrides:
  - Command: `ADMIN_PASS="$(cat ../../secrets/db_password_server)" PLAYWRIGHT_DB_HOST=localhost PLAYWRIGHT_DB_PORT=5439 PLAYWRIGHT_DB_ADMIN_PASSWORD=$ADMIN_PASS PLAYWRIGHT_DB_APP_PASSWORD=$ADMIN_PASS DB_PASSWORD_ADMIN=$ADMIN_PASS DB_PASSWORD=$ADMIN_PASS DB_PASSWORD_SERVER=$ADMIN_PASS DB_PASSWORD_SUPERUSER=$ADMIN_PASS npx playwright test src/__tests__/integration/workflow-designer-config.playwright.test.ts src/__tests__/integration/workflow-designer-publish.playwright.test.ts`
  - Result: **8/8 passed** (2.1m).
- Noisy server logs persisted (non-failing): Redis `WRONGPASS/NOAUTH` notifications and occasional 401 `Unauthorized` from registry/schema actions.

## 2025-12-22 — Playwright UI tests (batch 14: publish + latest published version)
- Added publish flow tests in `ee/server/src/__tests__/integration/workflow-designer-publish.playwright.test.ts`:
  - publish success clears errors + warnings (by removing invalid steps and re-publishing)
  - publish errors reset when switching workflows
  - publish button disabled while publish in progress (uses publish delay override)
  - publish failure toast preserves draft (uses failPublish override)
  - publish success updates latest published version indicator
- Added Playwright overrides in `WorkflowDesigner` for publish delay/failure, and surfaced latest published version in UI (`#workflow-designer-published-version`).
- Updated `listWorkflowDefinitionsAction` to include `published_version` (max version per workflow) and added type support in shared model.
- Marked publish-related UI checklist items as implemented, including step error badge count.
- Test run (env8 DB) passed:
  - Command (from `ee/server`): `ADMIN_PASS="$(cat ../../secrets/db_password_server)" PLAYWRIGHT_DB_HOST=localhost PLAYWRIGHT_DB_PORT=5439 PLAYWRIGHT_DB_ADMIN_PASSWORD=$ADMIN_PASS PLAYWRIGHT_DB_APP_PASSWORD=$ADMIN_PASS PLAYWRIGHT_DB_NAME=alga_contract_wizard_test npx playwright test src/__tests__/integration/workflow-designer-publish.playwright.test.ts`
  - Result: **8/8 passed** (2.3m).
- Non-failing noisy logs: intermittent 401 Unauthorized from workflow actions, Redis WRONGPASS reconnect errors, and various migration/seed warnings during bootstrap.

## 2025-12-22 — Playwright UI tests (batch 15: runs details + admin bulk actions)
- Added run detail status selector: `workflow-run-detail-status` in `ee/server/src/components/workflow-designer/WorkflowRunDetails.tsx`.
- Updated runs test helpers to also insert `workflow_definition_versions` so runtime resume/cancel can execute.
- Added run details + admin/bulk action tests in `ee/server/src/__tests__/integration/workflow-designer-runs.playwright.test.ts`:
  - run row click opens details panel
  - run details shows workflow name/version + status badge
  - admin selection checkboxes + bulk action controls
  - select all toggles selection
  - bulk resume/cancel flows
  - bulk action clears selection
- Updated checklist items to implemented in `ee/docs/plans/workflow_ui_test_plan.json` for the above.
- Test run (env8 DB):
  - Command (from `ee/server`):
    `PLAYWRIGHT_APP_PORT=3314 PLAYWRIGHT_DB_HOST=localhost PLAYWRIGHT_DB_PORT=5439 PLAYWRIGHT_DB_ADMIN_PASSWORD=$(cat ../../secrets/postgres_password) PLAYWRIGHT_DB_APP_PASSWORD=$(cat ../../secrets/postgres_password) PLAYWRIGHT_DB_NAME=alga_contract_wizard_test REDIS_HOST=localhost REDIS_PORT=6386 SECRET_READ_CHAIN=env SECRET_WRITE_PROVIDER=env npx playwright test src/__tests__/integration/workflow-designer-runs.playwright.test.ts -g "run details panel|run metadata|admin sees run selection|select all toggles|bulk resume|bulk cancel|bulk action clears"`
  - Result: **7/7 passed** (1.6m).
- Noisy but non-failing logs continue: `NOAUTH` notification accumulator, occasional `ECONNRESET`, intermittent Unauthorized from workflow actions during background load.

## 2025-12-22 — Playwright UI tests (batch 16: run detail admin actions + export/error)
- Environment note: using `workflow-overhaul/workflow_overhaul_env8` stack.
- Added run detail helpers in `ee/server/src/__tests__/integration/workflow-designer-runs.playwright.test.ts`:
  - `openRunDetails`, `createWorkflowRunStep`, optional run error/node fields, wait type override.
- Added run-detail tests:
  - error card renders on failed run
  - run export downloads JSON bundle
  - admin resume/cancel/retry/replay/requeue actions (with reasons/payload)
- Marked corresponding checklist items implemented in `ee/docs/plans/workflow_ui_test_plan.json`.
- Test run (env8 DB):
  - Command (from `ee/server`):
    `PLAYWRIGHT_APP_PORT=3314 PLAYWRIGHT_DB_HOST=localhost PLAYWRIGHT_DB_PORT=5439 PLAYWRIGHT_DB_ADMIN_PASSWORD=$(cat ../../secrets/postgres_password) PLAYWRIGHT_DB_APP_PASSWORD=$(cat ../../secrets/postgres_password) PLAYWRIGHT_DB_NAME=alga_contract_wizard_test REDIS_HOST=localhost REDIS_PORT=6386 SECRET_READ_CHAIN=env SECRET_WRITE_PROVIDER=env npx playwright test src/__tests__/integration/workflow-designer-runs.playwright.test.ts -g "run details shows run error card|run details export|admin resume action|admin cancel action|admin retry action|admin replay action|admin requeue action"`
  - Result: **7/7 passed** (1.8m).
- Noisy but non-failing logs: `NOAUTH` notification accumulator, intermittent `ECONNRESET` during test navigation, and post-teardown `Unauthorized` from `listWorkflowRunStepsAction`.

## 2025-12-22 UI Playwright progress (batch)
- Env confirmed: workflow_overhaul_env8 stack.
- Dead Letter tests: fixed row status locator and changed error-handling test to remove workflow admin permission and assert toast via [role="status"].
  - File: ee/server/src/__tests__/integration/workflow-designer-dead-letter.playwright.test.ts
  - Result: `npx playwright test ...dead-letter...` => 7 passed.
- Audit tests: error-handling test now revokes workflow admin permission and asserts toast via [role="status"] with polling.
  - File: ee/server/src/__tests__/integration/workflow-designer-audit.playwright.test.ts
  - Result: `npx playwright test ...audit...` => 6 passed.
- E2E flows: `npx playwright test ...workflow-designer-e2e...` => 5 passed.
- workflow_ui_test_plan.json now shows 0 remaining unimplemented items.

## 2025-12-22 — Runs error handling tests stabilized
- Updated runs error-handling tests to avoid flaky server-action interception:
  - `run list fetch error` now uses invalid workflow version (`0`) to trigger validation error and toast.
  - `run details fetch error` now deletes the run record before clicking view to force a 404 + toast + close.
- Removed unused server-action manifest lookup helpers from `ee/server/src/__tests__/integration/workflow-designer-runs.playwright.test.ts`.
- Test run:
  - Command (from `ee/server`):
    `PLAYWRIGHT_APP_PORT=3310 PLAYWRIGHT_DB_HOST=localhost PLAYWRIGHT_DB_PORT=5439 PLAYWRIGHT_DB_NAME=alga_contract_wizard_test PLAYWRIGHT_DB_ADMIN_USER=postgres PLAYWRIGHT_DB_ADMIN_PASSWORD=$(cat ../../secrets/postgres_password) PLAYWRIGHT_DB_APP_USER=app_user PLAYWRIGHT_DB_APP_PASSWORD=$(cat ../../secrets/db_password_server) PW_REUSE=true npx playwright test src/__tests__/integration/workflow-designer-runs.playwright.test.ts -g "run list fetch error|run details fetch error"`
  - Result: **2/2 passed**.
- Note: noisy but non-failing server logs still show intermittent Unauthorized errors during background fetches.

## 2025-12-22 — Playwright UI tests (batch 17: audit + dead-letter + events + e2e combined)
- Env: workflow_overhaul_env8 stack.
- Ran combined suite to validate cross-page flows after recent fixes.
- Command (from `ee/server`):
  `PLAYWRIGHT_APP_PORT=3312 PLAYWRIGHT_DB_HOST=localhost PLAYWRIGHT_DB_PORT=5439 PLAYWRIGHT_DB_NAME=alga_contract_wizard_test PLAYWRIGHT_DB_ADMIN_USER=postgres PLAYWRIGHT_DB_ADMIN_PASSWORD=$(cat ../../secrets/postgres_password) PLAYWRIGHT_DB_APP_USER=app_user PLAYWRIGHT_DB_APP_PASSWORD=$(cat ../../secrets/db_password_server) REDIS_HOST=localhost REDIS_PORT=6386 npx playwright test src/__tests__/integration/workflow-designer-events.playwright.test.ts src/__tests__/integration/workflow-designer-dead-letter.playwright.test.ts src/__tests__/integration/workflow-designer-audit.playwright.test.ts src/__tests__/integration/workflow-designer-e2e.playwright.test.ts`
- Result: **36/36 passed** (5.4m).
- Noise: expected Unauthorized/Forbidden logs during error-handling tests and background fetches; no test failures.

## 2025-12-22 — Playwright UI tests (batch 18: basic suite)
- Env: workflow_overhaul_env8 stack (app port 3312).
- Command (from `ee/server`):
  `PLAYWRIGHT_APP_PORT=3312 PLAYWRIGHT_DB_HOST=localhost PLAYWRIGHT_DB_PORT=5439 PLAYWRIGHT_DB_NAME=alga_contract_wizard_test PLAYWRIGHT_DB_ADMIN_USER=postgres PLAYWRIGHT_DB_ADMIN_PASSWORD=$(cat ../../secrets/postgres_password) PLAYWRIGHT_DB_APP_USER=app_user PLAYWRIGHT_DB_APP_PASSWORD=$(cat ../../secrets/db_password_server) REDIS_HOST=localhost REDIS_PORT=6386 npx playwright test src/__tests__/integration/workflow-designer-basic.playwright.test.ts`
- Result: **27/27 passed** (4.1m).
- Noise: recurring `ECONNRESET` + Unauthorized/Forbidden logs from server actions during negative paths; no test failures.

## 2025-12-22 — Playwright UI tests (batch 19: runs detail sub-suite)
- Env: workflow_overhaul_env8 stack (app port 3312).
- Command (from `ee/server`):
  `PLAYWRIGHT_APP_PORT=3312 PLAYWRIGHT_DB_HOST=localhost PLAYWRIGHT_DB_PORT=5439 PLAYWRIGHT_DB_NAME=alga_contract_wizard_test PLAYWRIGHT_DB_ADMIN_USER=postgres PLAYWRIGHT_DB_ADMIN_PASSWORD=$(cat ../../secrets/postgres_password) PLAYWRIGHT_DB_APP_USER=app_user PLAYWRIGHT_DB_APP_PASSWORD=$(cat ../../secrets/db_password_server) REDIS_HOST=localhost REDIS_PORT=6386 npx playwright test src/__tests__/integration/workflow-designer-runs.playwright.test.ts --grep "(runs row click|run details panel|admin sees run selection|select all toggles|bulk resume|bulk cancel|bulk action clears|run details shows|run details export|admin resume action|admin cancel action|admin retry action|admin replay action|admin requeue action|step timeline filter|collapse nested blocks|step timeline view|step details show|step error card|step wait history|envelope tabs|envelope view shows redaction|envelope view shows empty-state|action invocations list|action invocations empty state|run logs tab|run logs export|run logs load more|run logs empty|run audit logs tab|run audit logs load more|run audit logs empty)"`
- Result: **33/33 passed** (4.9m).
- Noise: intermittent `ECONNRESET` and a transient `Unauthorized` in server logs for `listWorkflowRunStepsAction` during admin replay flow; no test failures.

## 2025-12-22 — Playwright UI tests (batch 20: runs tab + publish + config)
- Env: workflow_overhaul_env8 stack (app port 3312).
- Command (from `ee/server`):
  `PLAYWRIGHT_APP_PORT=3312 PLAYWRIGHT_DB_HOST=localhost PLAYWRIGHT_DB_PORT=5439 PLAYWRIGHT_DB_NAME=alga_contract_wizard_test PLAYWRIGHT_DB_ADMIN_USER=postgres PLAYWRIGHT_DB_ADMIN_PASSWORD=$(cat ../../secrets/postgres_password) PLAYWRIGHT_DB_APP_USER=app_user PLAYWRIGHT_DB_APP_PASSWORD=$(cat ../../secrets/db_password_server) REDIS_HOST=localhost REDIS_PORT=6386 npx playwright test src/__tests__/integration/workflow-designer-runs.playwright.test.ts src/__tests__/integration/workflow-designer-publish.playwright.test.ts src/__tests__/integration/workflow-designer-config.playwright.test.ts --grep "(runs (tab lists|tab shows summary counts by status|filter by status|filter by workflow id and version updates list|search filters by run id or correlation key|date range filters update list|sort order changes list ordering|reset filters restores defaults and reloads list|quick range buttons set date inputs|refresh reloads list without changing filters|export triggers CSV download and success toast|load more appends additional results|empty state displays when no runs available)|run list fetch error shows toast and preserves filters|run details fetch error shows toast and closes details panel|publish|node config renders|json field|action\\.call config)"`
- Result: **28/28 passed** (4.1m).
- Noise: recurring `ECONNRESET` and `Unauthorized` errors in server logs during background fetches; expected Zod validation errors for invalid version in error-handling tests; no test failures.

## 2025-12-22 — Playwright UI tests (batch 21: flake fixes for runs/expression selectors)
- Env: workflow_overhaul_env8 stack (app port 3312).
- Fixes:
  - Expression picker tests now select exact listbox option to avoid matching `payload.*` entries.
  - `openRunsTab` now clicks the Runs tab by role/name and waits for `data-state="active"` before proceeding (also updated in E2E helper).
- Command (from `ee/server`):
  `PLAYWRIGHT_APP_PORT=3312 PLAYWRIGHT_DB_HOST=localhost PLAYWRIGHT_DB_PORT=5439 PLAYWRIGHT_DB_NAME=alga_contract_wizard_test PLAYWRIGHT_DB_ADMIN_USER=postgres PLAYWRIGHT_DB_ADMIN_PASSWORD=$(cat ../../secrets/postgres_password) PLAYWRIGHT_DB_APP_USER=app_user PLAYWRIGHT_DB_APP_PASSWORD=$(cat ../../secrets/db_password_server) REDIS_HOST=localhost REDIS_PORT=6386 npx playwright test src/__tests__/integration/workflow-designer-expressions.playwright.test.ts src/__tests__/integration/workflow-designer-runs.playwright.test.ts -g "expression field inserts|expression field combines|bulk cancel prompts|step timeline filter by node type|action invocations list renders|run audit logs empty state"`
- Result: **6/6 passed** (1.4m).
- Note: Server startup logs are noisy; no new Unauthorized/Forbidden issues observed in these runs.

## 2025-12-22 — Playwright UI tests (batch 22: controls + blocks + expressions)
- Env: workflow_overhaul_env8 stack (app port 3312).
- Command (from `ee/server`):
  `PLAYWRIGHT_APP_PORT=3312 PLAYWRIGHT_DB_HOST=localhost PLAYWRIGHT_DB_PORT=5439 PLAYWRIGHT_DB_NAME=alga_contract_wizard_test PLAYWRIGHT_DB_ADMIN_USER=postgres PLAYWRIGHT_DB_ADMIN_PASSWORD=$(cat ../../secrets/postgres_password) PLAYWRIGHT_DB_APP_USER=app_user PLAYWRIGHT_DB_APP_PASSWORD=$(cat ../../secrets/db_password_server) REDIS_HOST=localhost REDIS_PORT=6386 npx playwright test src/__tests__/integration/workflow-designer-controls.playwright.test.ts src/__tests__/integration/workflow-designer-blocks.playwright.test.ts src/__tests__/integration/workflow-designer-expressions.playwright.test.ts`
- Result: **29/29 passed** (2.8m).
- Noise: intermittent Unauthorized/Forbidden logs during background fetches and occasional `ECONNRESET`/`Error: aborted` messages; no test failures.
