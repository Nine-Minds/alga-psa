# Email Reply Heuristics Plan

## Objective
- Build a reliable heuristic system that extracts only the new reply content from inbound emails and posts it as ticket comments.
- Embed reply-friendly markers in outbound notifications so the heuristics have consistent anchors.
- Provide unit (Vitest) coverage across representative email formats (Gmail, Outlook, Apple Mail, forwarded responses, signature-heavy replies).

## Key Files & Responsibilities
- `server/src/lib/notifications/sendEventEmail.ts` — centralizes outbound email delivery; will add reply markers and conversation tokens.
- `server/src/lib/eventBus/subscribers/ticketEmailSubscriber.ts` & `projectEmailSubscriber.ts` — construct email context; will inject token metadata for reply tracking.
- `shared/workflow/workflows/system-email-processing-workflow.ts` — orchestrates inbound email handling; will call the reply parsing helper before creating comments.
- `server/src/services/email/EmailProcessor.ts` & provider webhooks — emit `INBOUND_EMAIL_RECEIVED`; may pass through normalized metadata for parsing.
- `server/src/lib/email/replyParser.ts` (new) — shared heuristics for trimming quotes, signatures, and portal banners with comprehensive Vitest coverage.
- `server/src/lib/email/__fixtures__/` (new) — sample raw emails used by tests (plain text, HTML, multilingual headers, forwarded chains).

## Phase 1 – Discovery & Instrumentation
- [x] Audit current inbound email payload structure (raw MIME, parsed HTML/text) and note gaps needed by the parser.
- [x] Capture sample outbound emails (ticket created/updated/comment) to catalogue existing banners, signatures, and layout differences.
- [x] Document provider-specific behaviors (Gmail, Outlook, Microsoft Graph) in `docs/inbound-email/` for reference.

## Phase 2 – Reply Parsing Library
- [x] Implement `replyParser.ts` with layered heuristics (custom delimiter, provider markers, quote detection, signature stripping, fallback diffing).
- [x] Add Vitest suites covering plaintext, HTML, top-posted, bottom-posted, inline replies, and forwards; include snapshot-based assertions for sanitized output.
- [x] Provide configuration surface (delimiter text, localization tokens) with sane defaults and documentation.

## Phase 3 – Inbound Workflow Integration
- [x] Update `system-email-processing-workflow.ts` (and related actions) to call the parser before creating ticket comments; ensure HTML is sanitized when necessary.
- [x] Persist original raw body when parsing confidence is low (feature flag/fallback) and surface warning logs for operator review.
- [x] Extend attachment handling so trimmed replies still associate incoming files correctly.

## Phase 4 – Outbound Enhancements
- [x] Add explicit “reply above this line” markers and hidden thread tokens to outbound notification templates via `sendEventEmail` context.
- [x] Store outbound message tokens (ticketId, commentId) so the inbound parser can map replies even when subjects change.
- [x] Update ticket/project email subscribers to pass token metadata into templates and ensure migrations cover template revisions.

