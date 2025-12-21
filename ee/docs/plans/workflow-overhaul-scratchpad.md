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

