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
