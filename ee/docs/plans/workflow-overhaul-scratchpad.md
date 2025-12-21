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
