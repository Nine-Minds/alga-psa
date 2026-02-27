# SCRATCHPAD — 2026-02-27 Inbound Email In-App Artifact Persistence (Remaining Work)

## Scope Intent

Create a clean, implementation-ready plan containing only remaining work for inbound email artifact persistence in the in-app callback path.

## Discovery Notes

- IMAP webhook currently publishes `INBOUND_EMAIL_RECEIVED` and returns `handoff: event_bus` rather than using in-app processing directly.
  - `packages/integrations/src/webhooks/email/imap.ts`
- Google and Microsoft webhook handlers already have an in-app processing branch controlled by `isInboundEmailInAppProcessingEnabled(...)`.
  - `packages/integrations/src/webhooks/email/google.ts`
  - `packages/integrations/src/webhooks/email/microsoft.ts`
- `processInboundEmailInApp` currently handles ticket/comment logic and calls attachment processing, but does not run embedded extraction or original `.eml` persistence.
  - `shared/services/email/processInboundEmailInApp.ts`
- Workflow definitions mention embedded extraction + `.eml` actions, but this remaining-work plan intentionally focuses on in-app callback parity.
  - `shared/workflow/workflows/system-email-processing-workflow.ts`

## Locked Decisions

- Persist only HTML-referenced CID inline images.
- Use deterministic `.eml` filename convention `original-email-<sanitized-message-id>.eml`.
- App-local in-process async worker mode is allowed.

## Open Questions

- None for this planning pass; scope is constrained to remaining in-app gap closure.

## Validation Commands

- `python3 scripts/validate_plan.py ee/docs/plans/2026-02-27-inbound-email-inapp-artifact-persistence-remaining-work`

## Implementation Log

- 2026-02-27: Completed `F214` by validating and activating the remaining-work plan artifact set at:
  - `ee/docs/plans/2026-02-27-inbound-email-inapp-artifact-persistence-remaining-work/PRD.md`
  - `ee/docs/plans/2026-02-27-inbound-email-inapp-artifact-persistence-remaining-work/features.json`
  - `ee/docs/plans/2026-02-27-inbound-email-inapp-artifact-persistence-remaining-work/tests.json`
  - `ee/docs/plans/2026-02-27-inbound-email-inapp-artifact-persistence-remaining-work/SCRATCHPAD.md`
- Rationale: The plan scope existed but had all checklist entries disabled; flipping `F214` records that the remaining-work scope artifact is now established and tracked as implementation source-of-truth.
- 2026-02-27: Completed `F215` by extracting artifact execution into shared orchestrator modules:
  - `shared/services/email/processInboundEmailArtifacts.ts`
  - `shared/services/email/inboundEmailArtifactHelpers.ts`
  - Wired call-sites in `shared/services/email/processInboundEmailInApp.ts` for:
    - reply-token flow
    - thread-header flow
    - new-ticket flow
- Decision: Keep orchestration in shared service layer so Google/Microsoft/IMAP in-app paths naturally converge via existing `processInboundEmailInApp` entrypoint.
- Validation:
  - `npx tsc -p shared/tsconfig.json --noEmit`
- Gotcha:
  - Repo Vitest config only includes `server/src` + `../packages`; direct `shared/services/email/__tests__` file filters are not discovered by default runner config.
- 2026-02-27: Completed `F216`.
  - `persistInboundEmailAttachment(...)` now consumes `attachmentData.content` (base64) when present before any provider download fallback.
  - File bytes are decoded and fed into storage-backed document persistence, enabling in-app callback payloads (including IMAP/local test payloads) to attach real files without workflow-worker execution.
- 2026-02-27: Completed `F217`.
  - `persistDocumentForBuffer(...)` now performs full persistence chain for in-app artifacts:
    - inserts `external_files`
    - inserts `documents` linked to `file_id`
    - inserts `document_associations` to the target `ticket`.
  - This replaces metadata-only attachment behavior in the in-app path.
- 2026-02-27: Completed `F218`.
  - Added shared `extractEmbeddedImageAttachments(...)` helper and wired it in `processInboundEmailArtifactsBestEffort(...)`.
  - In-app path now extracts HTML `data:image/*;base64,...` artifacts and feeds them through the same persistence pipeline as normal attachments.
- 2026-02-27: Completed `F219`.
  - Embedded extraction now maps only HTML-referenced `cid:` values to inline MIME parts.
  - Unreferenced inline CID attachments are not synthesized/persisted, matching the locked decision to persist only referenced CID images.
- 2026-02-27: Completed `F220`.
  - Synthetic embedded artifacts are emitted with deterministic IDs (`embedded-data-*`, `embedded-cid-*`) and normalized attachment fields (`id/name/contentType/size/content`).
  - Orchestrator appends these synthetic records to provider attachments and runs one shared persistence path.
- 2026-02-27: Completed `F221`.
  - Added `.eml` persistence step (`persistInboundOriginalEmail`) into in-app orchestration for both reply and new-ticket flows.
  - The original message is persisted as `message/rfc822` through the same storage/document association path as other artifacts.
- 2026-02-27: Completed `F222`.
  - Implemented MIME source selection with precedence in `maybeExtractRawMimeFromEmailData(...)`:
    - `rawMimeBase64`
    - `sourceMimeBase64`
    - `rawSourceBase64`
  - When no source bytes are available, `.eml` fallback generation uses deterministic RFC822 assembly (`buildDeterministicRfc822Message(...)`).
- 2026-02-27: Completed `F223`.
  - `.eml` persistence now uses deterministic file naming via `buildOriginalEmailFileName(messageId)` with `original-email-<sanitized-message-id>.eml` convention.
- 2026-02-27: Completed `F224`.
  - Added artifact-level idempotent claiming via `email_processed_attachments` primary key `(tenant, provider_id, email_id, attachment_id)`.
  - Deterministic attachment IDs now cover:
    - provider attachments (`attachment.id`)
    - synthetic embedded artifacts (`embedded-data-*`, `embedded-cid-*`)
    - original email source (`__original_email_source__`).
