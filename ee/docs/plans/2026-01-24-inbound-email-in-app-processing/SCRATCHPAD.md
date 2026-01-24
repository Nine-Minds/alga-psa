# Scratchpad — 2026-01-24 Inbound Email In-App Processing

## Context / Decision

- We are choosing **Option B** for now: bypass workflows entirely and call existing email “domain” functions directly in the webhook request flow.
- Goal remains to make workflow-worker **v2-only** and to remove inbound-email dependency on legacy workflow runtimes.

## Current wiring notes (file pointers)

- Gmail webhook route: `server/src/app/api/email/webhooks/google/route.ts` → `packages/integrations/src/webhooks/email/google.ts`
- Microsoft webhook route: `server/src/app/api/email/webhooks/microsoft/route.ts` → `packages/integrations/src/webhooks/email/microsoft.ts`
- V2 email workflow definition exists (not used in Option B): `shared/workflow/runtime/workflows/email-processing-workflow.v2.json`
- Legacy email workflow exists (not used in Option B): `shared/workflow/workflows/system-email-processing-workflow.ts`
- Domain helpers we will call:
  - `shared/workflow/actions/emailWorkflowActions.ts`
  - HTML conversion utility: `@alga-psa/shared/lib/utils/contentConversion` (see `shared/workflow/init/registerWorkflowActions.ts` for how it’s used)

## Commands I used during investigation

- `rg -n "INBOUND_EMAIL_RECEIVED|webhooks/email|email-processing-workflow.v2.json" -S server packages shared services`
- `sed -n '1,220p' shared/workflow/actions/emailWorkflowActions.ts`

## Open questions to resolve before implementation

- What do we do for **unmatched** senders (no contact match)?
- What is the canonical **idempotency key** per provider (Gmail historyId vs messageId)?
- Do we want comment bodies stored as BlockNote JSON (preferred), or raw text/html?

## Progress log

- 2026-01-24: Implemented F001 by defining the normalized `processInboundEmailInApp` contract/types in `shared/services/email/processInboundEmailInApp.ts` (input + union result shape).
- 2026-01-24: Implemented F002 by adding `processInboundEmailInApp()` in `shared/services/email/processInboundEmailInApp.ts` with in-app routing (existing ticket reply vs new-ticket creation).
- 2026-01-24: Implemented F003 by invoking `parseEmailReplyBody()` and falling back to raw body content on parser failures (logs + continue).
- 2026-01-24: Implemented F004 by resolving existing tickets via reply token first (if present), then falling back to thread headers via `findTicketByEmailThread`.
- 2026-01-24: Implemented F005 by creating reply comments with BlockNote JSON content (HTML→blocks when available, text→blocks otherwise) and storing message threading metadata on the comment.
- 2026-01-24: Implemented F006 by processing reply attachments per item via `processEmailAttachment` with error-continue semantics.
- 2026-01-24: Implemented F010 by requiring inbound ticket defaults per provider via `resolveInboundTicketDefaults(tenantId, providerId)` and skipping processing when missing.
- 2026-01-24: Implemented F011 by matching sender email to an existing contact via `findContactByEmail` and using its `client_id`/`contact_id` on ticket creation.
- 2026-01-24: Implemented F012 decision: if sender email does not match an existing contact, create the ticket under provider defaults `client_id` with `contact_id` unset, and mark the initial comment metadata with `unmatchedSender: true` for manual triage.
- 2026-01-24: Implemented F013 by creating tickets via `createTicketFromEmail` and persisting `tickets.email_metadata` (messageId/threadId/inReplyTo/references/providerId) for future threading queries.
- 2026-01-24: Implemented F014 by creating the initial ticket comment via `createCommentFromEmail` with BlockNote JSON content derived from the inbound email body.
- 2026-01-24: Implemented F015 by processing new-ticket attachments per item via `processEmailAttachment` with error-continue semantics.
- 2026-01-24: Implemented F020 by de-duping reply comment creation via a DB lookup keyed on `{tenant, ticket_id, metadata.email.messageId}` before inserting.
- 2026-01-24: Implemented F021 by de-duping new-ticket creation via a DB lookup on `tickets.email_metadata.messageId+providerId` before creating a ticket.
- 2026-01-24: Implemented F022 by re-enabling Gmail Pub/Sub historyId de-dupe (skip when `gmail_processed_history` already contains the notification historyId). Microsoft continues using `email_processed_messages` PK de-dupe.
- 2026-01-24: Implemented F030 by wiring Gmail webhook message handling to call `processInboundEmailInApp` when the in-app flag is enabled (otherwise preserves legacy `INBOUND_EMAIL_RECEIVED` publish).
- 2026-01-24: Implemented F031 by wiring Microsoft webhook notifications to call `processInboundEmailInApp` when enabled and to persist ticket linkage back to `email_processed_messages`.
- 2026-01-24: Implemented F040 by adding env-driven, tenant/provider-scoped gating in `shared/services/email/inboundEmailInAppFeatureFlag.ts` (`INBOUND_EMAIL_IN_APP_PROCESSING_ENABLED`, `INBOUND_EMAIL_IN_APP_TENANT_IDS`, `INBOUND_EMAIL_IN_APP_PROVIDER_IDS`).
- 2026-01-24: Implemented F041 by supporting provider-level rollout via `INBOUND_EMAIL_IN_APP_PROVIDER_IDS` allowlist.
- 2026-01-24: Implemented F050 by defaulting workflow-worker deployments to `WORKFLOW_WORKER_MODE=v2` in compose configs (`docker-compose.ce.yaml`, `docker-compose.ee.yaml`, and prebuilt variants).
- 2026-01-24: Implemented F051 by disabling legacy system email workflow updates by default in `services/workflow-worker/src/init/updateWorkflows.ts` (requires `LEGACY_SYSTEM_EMAIL_WORKFLOW_ENABLED=true` to opt back in).
- 2026-01-24: Implemented T001 with an integration test covering Gmail webhook → in-app processing path and asserting exactly one ticket and one initial comment (`server/src/test/integration/inboundEmailInApp.webhooks.integration.test.ts`).
- 2026-01-24: Implemented T002 with an integration test covering Microsoft webhook → in-app processing path and asserting exactly one ticket and one initial comment (`server/src/test/integration/inboundEmailInApp.webhooks.integration.test.ts`).
- 2026-01-24: Implemented T003 by adding an integration test for reply-token threading to ensure the in-app processor creates exactly one comment on the matched ticket (`server/src/test/integration/inboundEmailInApp.webhooks.integration.test.ts`).
- 2026-01-24: Implemented T004 by adding an integration test for header-based threading (In-Reply-To/References) to ensure the in-app processor creates exactly one comment on the matched ticket (`server/src/test/integration/inboundEmailInApp.webhooks.integration.test.ts`).
- 2026-01-24: Implemented T010 with a unit test ensuring `parseEmailReplyBody` produces non-empty sanitized text for plain-text emails (`server/src/test/unit/email/inboundEmailBodyParsing.test.ts`).
- 2026-01-24: Implemented T011 with a unit test ensuring `parseEmailReplyBody` produces sanitized HTML when HTML input is present (`server/src/test/unit/email/inboundEmailBodyParsing.test.ts`).
- 2026-01-24: Implemented T020 with an integration test verifying sender→contact matching overrides default client/contact on ticket creation (`server/src/test/integration/inboundEmailInApp.webhooks.integration.test.ts`).
