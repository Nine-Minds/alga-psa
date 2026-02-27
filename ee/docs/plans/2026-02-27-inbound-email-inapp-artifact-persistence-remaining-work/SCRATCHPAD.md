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
- 2026-02-27: Completed `F225`.
  - Artifact pipeline is explicitly best-effort:
    - per-attachment failures are logged and processing continues
    - `.eml` persistence failures are logged and do not interrupt ticket/comment return path.
  - `processInboundEmailInApp` now always returns reply/new-ticket outcomes independent of artifact persistence failures.
- 2026-02-27: Completed `F226`.
  - Reworked IMAP webhook route (`packages/integrations/src/webhooks/email/imap.ts`) to support:
    - direct in-app processing handoff (`handoff: "in_app"`)
    - app-local async in-process queue handoff (`handoff: "in_app_async"`)
    - explicit event-bus fallback on in-app failure (`handoff: "event_bus_fallback"`) when configured.
- 2026-02-27: Completed `F227`.
  - IMAP webhook payload normalization now enforces ingress caps for:
    - per-attachment bytes
    - total attachment bytes
    - attachment count
    - raw MIME bytes.
  - Caps are driven by existing IMAP env knobs:
    - `IMAP_MAX_ATTACHMENT_BYTES`
    - `IMAP_MAX_TOTAL_ATTACHMENT_BYTES`
    - `IMAP_MAX_ATTACHMENT_COUNT`
    - `IMAP_MAX_RAW_MIME_BYTES`.
- 2026-02-27: Completed `F228`.
  - Over-limit payload elements now emit structured `ingressSkipReasons` entries with deterministic reason enums:
    - `attachment_over_max_bytes`
    - `attachment_total_bytes_exceeded`
    - `attachment_count_exceeded`
    - `raw_mime_over_max_bytes`
  - Eligible attachments continue through in-app artifact processing.
- 2026-02-27: Completed `F229`.
  - Added app-local async IMAP callback queue (`packages/integrations/src/webhooks/email/imapInAppQueue.ts`).
  - Webhook can now defer in-app processing when `IMAP_INBOUND_EMAIL_IN_APP_ASYNC_ENABLED=true`, returning quickly with queue metadata.
- 2026-02-27: Completed `F230`.
  - Added explicit attachment artifact concurrency bounding in `processInboundEmailArtifactsBestEffort(...)` via:
    - `IMAP_INBOUND_EMAIL_IN_APP_ARTIFACT_CONCURRENCY`
    - `INBOUND_EMAIL_IN_APP_ARTIFACT_CONCURRENCY`
  - Async queue worker concurrency is separately bounded by `IMAP_INBOUND_EMAIL_IN_APP_ASYNC_WORKERS`.
- 2026-02-27: Completed `F231`.
  - IMAP webhook now validates and normalizes in-app payload contract fields before processing:
    - attachments `content`, `isInline`, `contentId`
    - MIME source fields `rawMimeBase64` / `sourceMimeBase64` / `rawSourceBase64`.
  - Malformed contract inputs return safe `400` responses instead of crashing callback execution.
- 2026-02-27: Completed `F232`.
  - Added IMAP-specific feature-flag helpers in `shared/services/email/inboundEmailInAppFeatureFlag.ts`:
    - `isImapInboundEmailInAppProcessingEnabled`
    - `isImapInboundEmailInAppAsyncModeEnabled`
    - `isImapInboundEmailInAppEventBusFallbackEnabled`
  - Documented supported flag/env combinations in `docs/inbound-email/setup/imap.md`.
- 2026-02-27: Completed `F233`.
  - Google and Microsoft webhook handlers already delegate in-app processing to `processInboundEmailInApp(...)`.
  - Because `processInboundEmailInApp` now routes all artifact handling through `processInboundEmailArtifactsBestEffort(...)`, provider behavior is unified for attachments, embedded extraction, and `.eml` persistence.
- 2026-02-27: Completed `F234`.
  - Added in-app integration assertion coverage in:
    - `server/src/test/integration/inboundEmailInApp.webhooks.integration.test.ts`
  - New scenario asserts ticket document outcomes for:
    - regular attachment (`regular.txt`)
    - embedded extraction artifact (`embedded-image-1.png`)
    - deterministic original email `.eml` document.
- Validation:
  - `cd server && npx vitest run src/test/integration/inboundEmailInApp.webhooks.integration.test.ts --coverage.enabled=false`
  - Result in this environment: suite discovered but DB-gated tests skipped (`describeDb` guard).
- 2026-02-27: Completed `F235`.
  - Added local operator runbook:
    - `ee/docs/plans/2026-02-27-inbound-email-inapp-artifact-persistence-remaining-work/GREENMAIL-IMAP-INAPP-RUNBOOK.md`
  - Runbook includes setup, SMTP send step, log checks, DB verification queries, and UI verification for regular/embedded/`.eml` artifact outcomes.
- 2026-02-27: Completed `T214`.
  - Added/maintained explicit assertion in `shared/services/email/__tests__/processInboundEmailInApp.test.ts` that `processInboundEmailArtifactsBestEffort(...)` is invoked for the new-ticket flow.
  - Assertion verifies ordering: comment creation occurs before artifact orchestrator invocation using `invocationCallOrder`.
  - Added shared Vitest alias config in `shared/vitest.config.ts` and completed workflow-action mock shape updates required by current `processInboundEmailInApp` imports.
- Validation:
  - `npx vitest run --config shared/vitest.config.ts shared/services/email/__tests__/processInboundEmailInApp.test.ts -t "contact\\+user forwards both author_id and contact_id" --coverage.enabled=false`
- 2026-02-27: Completed `T215`.
  - Verified reply-flow orchestration path invokes `processInboundEmailArtifactsBestEffort(...)` only after `createCommentFromEmail(...)`.
  - Scope validated on reply-token threaded flow in `shared/services/email/__tests__/processInboundEmailInApp.test.ts` using call-order assertion.
- Validation:
  - `npx vitest run --config shared/vitest.config.ts shared/services/email/__tests__/processInboundEmailInApp.test.ts -t "reply-token path resolves sender contact and forwards contact_id for contact-only sender" --coverage.enabled=false`
