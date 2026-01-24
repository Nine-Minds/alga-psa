# Inbound Email: move processing into app request flow (and keep worker v2-only)

## Why this exists

Inbound email currently enters the system via webhook route handlers, but the “email → ticket/comment” work is still performed by the workflow-worker by consuming `workflow:events:global`.

This note captures what’s currently wired and what needs to change if we want:

1) inbound email processing to run **in the normal server request flow** (webhook handler / server-side code), and  
2) the workflow-worker service to run **only the v2 runtime** (no legacy TypeScript workflow worker).

## Current wiring (concrete pointers)

### Webhook entrypoints

- Gmail Pub/Sub push: `POST server/src/app/api/email/webhooks/google/route.ts` → `packages/integrations/src/webhooks/email/google.ts`
- Microsoft Graph webhook: `GET|POST server/src/app/api/email/webhooks/microsoft/route.ts` → `packages/integrations/src/webhooks/email/microsoft.ts`
- Test helper: `POST server/src/app/api/email/webhooks/test/route.ts` → `packages/integrations/src/webhooks/email/test.ts`
- MailHog polling (E2E/dev): `server/src/services/email/MailHogPollingService.ts` → `server/src/services/email/EmailProcessor.ts`

### What the webhooks do today

Both Gmail + Microsoft handlers:

- validate/identify provider + tenant (DB lookups under `email_providers`, `google_email_provider_config`, and Microsoft config columns),
- fetch full message details (`GmailAdapter`, `MicrosoftGraphAdapter`),
- publish `INBOUND_EMAIL_RECEIVED` onto the **workflow global Redis stream** via `shared/events/publisher.ts` (which uses `shared/workflow/streams/redisStreamClient.ts`).

### Workflow definitions involved

Two separate “email processing workflows” exist today:

- **Legacy/system workflow (TypeScript runtime)**:
  - Source: `shared/workflow/workflows/system-email-processing-workflow.ts`
  - Registered via migrations like `server/migrations/20250707201500_register_email_processing_workflow.cjs` and updates such as `server/migrations/20250814173000_embed_system_email_processing_workflow_inline_v2.cjs`
  - Stored under `system_workflow_registrations` / `system_workflow_registration_versions`
- **V2 workflow (graph runtime)**:
  - Definition JSON: `shared/workflow/runtime/workflows/email-processing-workflow.v2.json`
  - Registered by `server/migrations/20251221103000_register_email_workflow_runtime_v2.cjs`
  - Stored under `workflow_definitions` / `workflow_definition_versions`

### Who executes the workflow today

The workflow-worker service (`services/workflow-worker/src/index.ts`) can start:

- Legacy runtime: `services/workflow-worker/src/WorkflowWorker.ts` (Redis streams consumer + TypeScript workflow runtime)
- V2 runtime:
  - scheduler: `shared/workflow/workers/WorkflowRuntimeV2Worker.ts`
  - event ingest: `services/workflow-worker/src/v2/WorkflowRuntimeV2EventStreamWorker.ts`

Runtime selection is via `WORKFLOW_WORKER_MODE=all|legacy|v2` (see `services/workflow-worker/src/index.ts`).

## What “process inbound email in request flow” means (practically)

To avoid the workflow-worker being required for inbound email, the webhook handlers must stop publishing `INBOUND_EMAIL_RECEIVED` to `workflow:events:global` and instead execute the email-processing logic directly (or run the v2 workflow engine in-process).

There are two viable shapes:

### Option A (recommended): run v2 workflow in-process from the webhook

The v2 email workflow (`shared/workflow/runtime/workflows/email-processing-workflow.v2.json`) already expresses:

- threading (comment on existing ticket),
- creating a new ticket with defaults,
- attachments,
- human tasks on error / matching.

So the webhook can:

1) Build the v2 payload (`payload.EmailWorkflowPayload.v1`) from `{tenantId, providerId, emailData}`.
2) Start + execute the v2 run **in-process** using `WorkflowRuntimeV2` (not via Redis stream ingest).
3) Return `200` quickly once the run completes (or after it reaches a wait / human task).

Why this fits the stated goals:

- inbound email is processed “in-app” without the dedicated worker consuming streams,
- the v2 system remains the only workflow runtime we invest in,
- the workflow-worker can be simplified to v2-only without needing a separate email-specific worker.

Key new code needed:

- A non-auth “internal” runner helper callable from webhooks (webhooks already authenticate via JWT/signatures):
  - e.g. `server/src/services/email/runInboundEmailWorkflowV2.ts` (name TBD)
  - uses `WorkflowRuntimeV2`, `WorkflowDefinitionModelV2`, `WorkflowDefinitionVersionModelV2`, and tenant DB connection utilities
  - should record a `workflow_runtime_events` row (optional but recommended for audit/idempotency parity with stream ingest)

Edits needed:

- `packages/integrations/src/webhooks/email/google.ts`: replace `publishEvent({ eventType: 'INBOUND_EMAIL_RECEIVED', ... })` with the in-process runner call.
- `packages/integrations/src/webhooks/email/microsoft.ts`: same replacement.

### Option B: bypass workflows entirely, call email domain functions directly

We can re-implement the workflow steps as a regular service function (no workflow runtime involved), likely by calling the same underlying helpers the v2 actions wrap (see `shared/workflow/actions/emailWorkflowActions`).

This is simpler operationally, but has downsides:

- you lose the workflow run trace, waits, retries, and future graph edits for email without rebuilding logic,
- “human task + resume” becomes a bespoke state machine you must implement and maintain.

## Making the workflow-worker v2-only

Once inbound email no longer depends on the legacy runtime, the workflow-worker can be simplified to always start only the v2 workers:

- Remove legacy start path from `services/workflow-worker/src/index.ts` (or hard-code mode to v2).
- Remove unused legacy-only initializers (e.g. `initializeServerWorkflows`, `updateSystemWorkflowsFromAssets`, legacy action registry wiring).

Separate (bigger) cleanup if “switch completely to v2” means removing legacy workflows everywhere:

- stop registering/updating `system_workflow_registrations*` (migrations/seeds),
- migrate any remaining legacy workflows to v2 definitions,
- eventually drop legacy tables.

## Risks / open questions to resolve before implementation

- **Timeout budget:** Gmail Pub/Sub and Microsoft webhooks have delivery expectations; ensure the in-process v2 run completes within acceptable time or returns early once it reaches a “wait” state.
- **Idempotency:** Gmail duplicate suppression in `packages/integrations/src/webhooks/email/google.ts` currently has the “skip if already processed” block commented out; we should confirm the desired idempotency contract and enforce it (DB uniqueness + workflow idempotency keys).
- **Human-task waits:** if the workflow creates human tasks and waits, confirm how that wait is resumed today (event-driven vs UI action). If resumption is only handled by the worker, we may need a server-side “resume” path.
- **Double-triggering:** while both legacy + v2 email workflows exist, ensure only one path runs (otherwise emails create duplicate tickets/comments).

## Suggested rollout plan (concrete)

1) Pick the authoritative email processing workflow:
   - either keep `shared/workflow/runtime/workflows/email-processing-workflow.v2.json` as the single source of truth, or
   - migrate any missing behavior from legacy (`shared/workflow/workflows/system-email-processing-workflow.ts`) into v2 first.
2) Implement an in-process v2 runner helper (server-only) and add a feature flag:
   - flag controls whether webhooks publish to Redis stream (old) vs run in-process (new).
3) Switch **one provider** first (recommend Microsoft because it already fetches full details inline):
   - enable flag for a single tenant/provider, verify ticket/comment creation, threading, attachments.
4) Disable legacy workflow-worker runtime (set `WORKFLOW_WORKER_MODE=v2` everywhere) once no flows depend on it.
5) After stability: remove legacy email workflow registrations and legacy worker code paths.
