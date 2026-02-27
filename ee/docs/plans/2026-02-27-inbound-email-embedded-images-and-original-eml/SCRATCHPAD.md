# Scratchpad — Inbound Email Embedded Images + Original EML as Ticket Documents

- Plan slug: `2026-02-27-inbound-email-embedded-images-and-original-eml`
- Created: `2026-02-27`

## What This Is

Rolling notes for embedded inbound-email image extraction + source `.eml` persistence plan.

## Decisions

- (2026-02-27) Scope includes both:
  - embedded image payload extraction (`data:image/*` + HTML-referenced `cid:` inline images)
  - original source email `.eml` persistence.
- (2026-02-27) Behavior applies to both new-ticket and reply-to-ticket inbound email flows.
- (2026-02-27) Keep failures non-blocking for core ticket/comment creation paths.
- (2026-02-27) Reuse existing idempotency model (`email_processed_attachments`) with synthetic attachment IDs for embedded images and source `.eml`.
- (2026-02-27) Implemented embedded-image extraction as a dedicated workflow action (`extract_embedded_email_attachments`) so parsing/validation/id generation are testable and deterministic outside the JS-only workflow file.
- (2026-02-27) Implemented original-source `.eml` persistence as dedicated workflow action (`process_original_email_attachment`) with reserved idempotency key `__original_email_source__`.
- (2026-02-27) For MailHog/IMAP/test inputs, source MIME resolution order is:
  - direct raw MIME fields on `emailData` (`rawMime`, `rawMimeBase64`, `sourceMimeBase64`, `rawSourceBase64`)
  - provider retrieval for Gmail/Microsoft
  - deterministic RFC822 fallback assembly.

## Discoveries / Constraints

- (2026-02-27) Existing inbound attachment action already writes storage-backed `external_files` + `documents` + `document_associations` and tracks idempotency in `email_processed_attachments`.
  - File: `services/workflow-worker/src/actions/registerEmailAttachmentActions.ts`
- (2026-02-27) Existing action currently skips inline/CID attachments by default (`contentId || isInline` -> skipped).
- (2026-02-27) Workflow invokes attachment processing in both paths:
  - reply path helper (`handleEmailReply`)
  - new ticket path attachment loop
  - File: `services/workflow-worker/src/workflows/system-email-processing-workflow.ts`
- (2026-02-27) Gmail adapter already exposes attachment metadata with `isInline` and `contentId`.
  - File: `server/src/services/email/providers/GmailAdapter.ts`
- (2026-02-27) Microsoft adapter supports file-attachment byte download but not yet source-message `.eml` retrieval method.
  - File: `shared/services/email/providers/MicrosoftGraphAdapter.ts`
- (2026-02-27) Event/type schemas currently model attachment metadata but need review for inline/content fields used in processing paths.
  - Files:
    - `packages/types/src/interfaces/email.interfaces.ts`
    - `packages/event-schemas/src/schemas/domain/emailWorkflowSchemas.ts`
    - `packages/event-schemas/src/schemas/eventBusSchema.ts`
- (2026-02-27) Related prior plan exists and can be referenced for baseline attachment ingestion behavior:
  - `ee/docs/plans/2026-01-11-email-attachments-to-tickets/`
- (2026-02-27) `process_email_attachment` now supports synthetic embedded payloads by honoring:
  - `allowInlineProcessing: true`
  - optional `providerAttachmentId` for CID-backed downloads
  - image-only enforcement for embedded extraction paths.
- (2026-02-27) Workflow now invokes document processing helper in both paths:
  - extract embedded images (best effort)
  - process base + synthetic attachments (best effort)
  - persist original `.eml` once (best effort).

## Commands / Runbooks

- (2026-02-27) Search inbound email + attachment processing paths:
  - `rg -n "process_email_attachment|INBOUND_EMAIL_RECEIVED|attachments|inline|cid|eml|rfc822" services/workflow-worker/src server/src packages`
- (2026-02-27) Inspect workflow + action implementation:
  - `sed -n '1,620p' services/workflow-worker/src/workflows/system-email-processing-workflow.ts`
  - `sed -n '1,760p' services/workflow-worker/src/actions/registerEmailAttachmentActions.ts`
- (2026-02-27) Inspect provider adapters:
  - `sed -n '520,760p' server/src/services/email/providers/GmailAdapter.ts`
  - `sed -n '430,700p' shared/services/email/providers/MicrosoftGraphAdapter.ts`
- (2026-02-27) Added helper module + tests:
  - `services/workflow-worker/src/actions/emailAttachmentHelpers.ts`
  - `server/src/test/unit/email/emailAttachmentHelpers.test.ts`
- (2026-02-27) Attempted workflow codegen refresh:
  - `node scripts/generate-system-email-workflow.cjs`
  - blocked in current workspace due missing local `typescript` package resolution.
- (2026-02-27) Attempted targeted vitest execution (blocked by missing dependencies in this workspace):
  - `npm run test:local -- ...` -> dotenv CLI arg parsing failure
  - `npx vitest run ...` -> missing `dotenv` / `vitest` package resolution at runtime.

## Links / References

- Existing ticket-doc attachment integration tests:
  - `server/src/test/integration/emailAttachmentIngestion.integration.test.ts`
  - `server/src/test/integration/systemEmailProcessingWorkflowAttachments.integration.test.ts`
  - `ee/server/src/__tests__/integration/email-attachments-to-ticket-documents.playwright.test.ts`
- Existing inbound-email attachment plan baseline:
  - `ee/docs/plans/2026-01-11-email-attachments-to-tickets/PRD.md`

## Open Questions

- Persist only HTML-referenced CID images, or all inline CID parts?
  - Draft assumption in PRD: only HTML-referenced CID images.
- Final `.eml` filename format preference.

- (2026-02-27) Completed F001 — Define embedded-image extraction scope to include HTML data URLs and HTML-referenced CID inline images.

- (2026-02-27) Completed T001 — Covered by emailAttachmentHelpers.test.ts: extracts data:image payload from a single <img> tag.
- (2026-02-27) Completed T002 — Covered by emailAttachmentHelpers.test.ts: extracts multiple data:image payloads in deterministic order.
- (2026-02-27) Completed T003 — Covered by emailAttachmentHelpers.test.ts: skips malformed data:image payload without throwing.
- (2026-02-27) Completed T004 — Covered by emailAttachmentHelpers.test.ts: rejects non-image data URLs.
- (2026-02-27) Completed T005 — Covered by emailAttachmentHelpers.test.ts: skips oversized embedded data URL payloads by max-size policy.
- (2026-02-27) Completed T006 — Covered by emailAttachmentHelpers.test.ts: maps cid references only to matching inline image MIME parts.
- (2026-02-27) Completed T007 — Covered by emailAttachmentHelpers.test.ts: skips unreferenced inline CID MIME parts.
- (2026-02-27) Completed T008 — Covered by emailAttachmentHelpers.test.ts: deterministic embedded IDs are stable across retries.
- (2026-02-27) Completed T009 — Covered by emailAttachmentHelpers.test.ts: deterministic embedded filenames are extension-appropriate and sanitized.
- (2026-02-27) Completed T010 — Covered by systemEmailProcessingWorkflowAttachments.integration.test.ts: new-ticket path invokes embedded extraction/processing.
- (2026-02-27) Completed T011 — Covered by systemEmailProcessingWorkflowAttachments.integration.test.ts: reply path invokes embedded extraction/processing.
- (2026-02-27) Completed T012 — Covered by emailAttachmentIngestion.integration.test.ts: synthetic embedded image creates external_files with expected mime/size.
- (2026-02-27) Completed T013 — Covered by emailAttachmentIngestion.integration.test.ts: synthetic embedded image creates documents metadata row.
- (2026-02-27) Completed T014 — Covered by emailAttachmentIngestion.integration.test.ts: synthetic embedded image creates ticket document_associations row.
- (2026-02-27) Completed T015 — Covered by emailAttachmentIngestion.integration.test.ts: duplicate synthetic embedded processing remains idempotent.
- (2026-02-27) Completed T016 — Covered by combined tests: emailAttachmentIngestion.integration.test.ts records failed processing; workflow integration keeps ticket/comment flow successful.
- (2026-02-27) Completed T017 — Covered by GmailAdapter.listMessagesSince.test.ts: downloadMessageSource returns raw MIME bytes.