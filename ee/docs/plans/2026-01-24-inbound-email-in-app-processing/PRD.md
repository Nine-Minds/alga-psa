# PRD — Inbound Email Processing In-App (Bypass Workflows for Now)

- Slug: `2026-01-24-inbound-email-in-app-processing`
- Date: `2026-01-24`
- Status: Draft

## Summary

Inbound email currently triggers workflow processing by publishing `INBOUND_EMAIL_RECEIVED` onto `workflow:events:global`, which requires the workflow-worker to be running. We want inbound email processing to run **in the normal server request flow** (webhook handler code) by calling existing email “domain” functions directly (Option B), and to remove any inbound-email dependency on legacy workflow runtimes.

## Problem

- Operational complexity: inbound email processing depends on workflow-worker (and Redis stream ingestion) being healthy.
- Architecture direction: workflows are moving to the v2 graph system, but the “email-to-ticket” workflow exists in multiple forms (legacy/system + v2 JSON).
- We need a pragmatic intermediate step: process inbound emails directly in-app *now*, then revisit workflow-based orchestration later.

## Goals

- Process inbound emails synchronously within the webhook request flow (no workflow engine required).
- Preserve existing product behavior:
  - Thread replies onto existing tickets when possible.
  - Otherwise create a new ticket using inbound ticket defaults.
  - Preserve attachments handling (best-effort; do not fail the whole email on attachment errors).
- Provide clear idempotency so webhook duplicates do not create duplicate tickets/comments.
- Enable the workflow-worker service to run **v2-only** (no legacy runtime required for inbound email).

## Non-goals

- Implementing inbound email as a v2 workflow run-in-process (Option A).
- Rebuilding the inbound-email provider integrations (OAuth, Pub/Sub setup, etc.).
- Adding observability/metrics dashboards, alerting, or tracing beyond what’s needed to ship the behavior.
- Re-architecting the “human task” experience; we will only implement minimal behavior needed for unmatched emails (see Open Questions).

## Users and Primary Flows

### Flow A — Gmail Pub/Sub inbound message (new ticket)

1. Gmail Pub/Sub webhook receives notification.
2. Webhook resolves provider + tenant, fetches email message details (existing behavior).
3. Webhook calls `processInboundEmailInApp({ tenantId, providerId, emailData })`.
4. The service resolves inbound ticket defaults for the provider.
5. The service matches sender → contact/client (exact match) when possible.
6. The service creates a new ticket, then adds the email body as the initial comment.
7. The service processes attachments best-effort.

### Flow B — Microsoft Graph inbound message (reply to existing ticket)

1. Microsoft webhook receives notification(s).
2. Webhook resolves provider + tenant, fetches email message details (existing behavior).
3. Webhook calls `processInboundEmailInApp({ tenantId, providerId, emailData })`.
4. The service attempts to resolve an existing ticket by reply token, thread id, In-Reply-To, and References.
5. If a ticket is found, the service creates a comment on that ticket and processes attachments best-effort.

## UX / UI Notes

- No new UI required for the first iteration.
- If unmatched emails cannot be reliably associated to a client, we may need to create a “triage” ticket (or a task) for staff to resolve. Exact behavior is an open question (see below).

## Current System (Code Pointers)

### Webhook entrypoints

- Gmail Pub/Sub: `server/src/app/api/email/webhooks/google/route.ts` → `packages/integrations/src/webhooks/email/google.ts`
- Microsoft Graph: `server/src/app/api/email/webhooks/microsoft/route.ts` → `packages/integrations/src/webhooks/email/microsoft.ts`

### Existing workflow-based processing

- V2 workflow definition: `shared/workflow/runtime/workflows/email-processing-workflow.v2.json`
- Legacy/system workflow: `shared/workflow/workflows/system-email-processing-workflow.ts`
- Worker entrypoint + mode selection: `services/workflow-worker/src/index.ts` (`WORKFLOW_WORKER_MODE=all|legacy|v2`)

### Domain functions to reuse (Option B)

Implement the in-app email processing service by calling functions in:

- `shared/workflow/actions/emailWorkflowActions.ts`
  - `parseEmailReplyBody`
  - `findTicketByReplyToken`
  - `findTicketByEmailThread`
  - `resolveInboundTicketDefaults`
  - `findContactByEmail`
  - `createOrFindContact`
  - `createTicketFromEmail`
  - `createCommentFromEmail`
  - `processEmailAttachment`
  - `saveEmailClientAssociation` (optional)

Use HTML → BlockNote conversion directly (not via workflow action):

- `@alga-psa/shared/lib/utils/contentConversion` (used by `convert_html_to_blocks` action in `shared/workflow/init/registerWorkflowActions.ts`)

## Requirements

### Functional Requirements

- Add a server-side service function, e.g. `processInboundEmailInApp`, that:
  - Parses/sanitizes email body using `parseEmailReplyBody` (and falls back safely).
  - Resolves threading:
    - If reply token exists → `findTicketByReplyToken`.
    - Else → `findTicketByEmailThread` using `{threadId, inReplyTo, references, originalMessageId}`.
  - Reply path:
    - Creates a ticket comment using `createCommentFromEmail`.
    - Processes attachments via `processEmailAttachment` (best-effort per attachment).
  - New-ticket path:
    - Resolves inbound ticket defaults via `resolveInboundTicketDefaults(tenant, providerId)`.
    - Finds sender contact via `findContactByEmail`; if found use its `client_id` and `contact_id`.
    - If not found, use defaults `client_id` (and determine how/if to create a contact — see Open Questions).
    - Creates ticket via `createTicketFromEmail`, including `email_metadata` for future threading.
    - Creates initial comment via `createCommentFromEmail`.
    - Processes attachments via `processEmailAttachment` (best-effort).
- Update Gmail and Microsoft webhook handlers to call the new service instead of publishing `INBOUND_EMAIL_RECEIVED` onto Redis workflow streams.

### Idempotency Requirements

- Avoid duplicate processing for the same message:
  - For Microsoft: use (or extend) existing `email_processed_messages` checks/updates in `packages/integrations/src/webhooks/email/microsoft.ts`.
  - For Gmail: decide whether `gmail_processed_history` is sufficient, and whether to re-enable the “skip duplicate” block currently commented out in `packages/integrations/src/webhooks/email/google.ts`.
- Inside `processInboundEmailInApp`, ensure comment creation for replies is idempotent (e.g. by checking for an existing comment keyed by message id, or relying on existing `INBOUND_EMAIL_REPLY_RECEIVED` domain event idempotency if applicable).

### Error Handling Requirements

- If attachment processing fails, do not fail the overall email processing.
- If defaults are missing for a provider, do not create tickets/comments; return success to webhook with a clear log entry and a durable record for staff to fix configuration.

## Data / Integrations Notes

- Gmail and Microsoft webhook handlers already fetch email details; the in-app service should be provider-agnostic and operate on normalized `emailData` (id, from/to, subject, body, attachments, thread headers).
- Ticket/threading relies on `tickets.email_metadata` queries in `findTicketByEmailThread`.

## Rollout / Migration

- Ship behind a feature flag (tenant- or provider-scoped) so we can switch providers one at a time.
- Once inbound email no longer depends on workflow-worker:
  - Default workflow-worker deployments to `WORKFLOW_WORKER_MODE=v2`.
  - Remove or deprecate the legacy email workflow registrations once confirmed unused.

## Open Questions

1. **Unmatched sender behavior:** if no contact exists for sender email, do we:
   - create ticket against provider defaults `client_id`, with no contact, and require manual triage, or
   - create a new contact under defaults `client_id`, or
   - create a dedicated “triage” client/queue, or
   - create a task-inbox item for manual matching (without blocking the webhook)?
2. **Comment format:** should we store email content as BlockNote JSON for richer rendering, or store HTML/text directly?
3. **Idempotency strategy:** what is the canonical “processed message” key per provider (Gmail historyId vs messageId)?
4. **Timeout budget:** what is the maximum acceptable webhook processing time before provider retries become problematic?

## Acceptance Criteria (Definition of Done)

- For a new inbound email (Gmail/Microsoft), the system creates exactly one ticket and one initial comment containing the email body.
- For a reply email that matches an existing ticket, the system creates exactly one new comment on that ticket containing the reply body.
- Attachments are processed best-effort; failures do not prevent ticket/comment creation.
- Replaying the same webhook notification does not create duplicate tickets/comments for the same underlying email message.
- Inbound email processing no longer requires the legacy workflow runtime; workflow-worker can run v2-only without breaking inbound email.

