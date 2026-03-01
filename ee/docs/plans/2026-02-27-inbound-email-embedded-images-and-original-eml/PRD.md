# PRD — Inbound Email Embedded Images + Original EML as Ticket Documents

- Slug: `2026-02-27-inbound-email-embedded-images-and-original-eml`
- Date: `2026-02-27`
- Status: Draft

## Summary

Extend inbound email **in-app callback-hook processing** so that:
1. Embedded email image components (HTML `data:image/...;base64,...` and referenced `cid:` inline images) are converted to stored ticket document attachments.
2. The original inbound email MIME message is stored as a `.eml` document attachment on the ticket.

This applies to both new-ticket and threaded-reply inbound email paths.

## Problem

Current behavior persists standard file attachments, but does not persist:
- Embedded image payloads in email HTML (data URLs and inline CID-referenced images).
- The original raw email message as a downloadable `.eml`.

As a result, tickets can miss visual evidence included inline by senders, and support teams cannot retrieve the source message artifact for audit/troubleshooting.

## Goals

- Persist embedded image payloads from inbound emails as ticket documents.
- Persist one original email `.eml` document per inbound email message.
- Keep behavior idempotent across retries and duplicate events.
- Keep ticket/comment creation resilient: embedded-image or `.eml` failures must not block main email ingestion.
- Support provider paths currently in scope for inbound email processing (Gmail, Microsoft, IMAP, MailHog test path).
- Keep this feature within in-app processing paths; no dependency on workflow-worker execution.
- Allow either direct in-request processing or app-local in-process async worker processing, provided the path remains app-local and does not require external workflow-worker/event-bus execution.

## Non-goals

- Rebuilding email/comment rendering UI or adding new document UI components.
- Rewriting comment body HTML to replace inline image URLs with hosted document URLs.
- Processing non-image inline MIME parts as documents.
- Adding antivirus, content moderation, or advanced document classification.
- Queue-level/global backpressure orchestration beyond per-message bounded processing.
- New observability/metrics initiatives beyond existing logs for this phase.
- Refactoring legacy workflow-worker/system-workflow inbound email paths in this phase.

## Users and Primary Flows

### Flow A — New inbound email with embedded images

1. Email creates a new ticket.
2. In-app inbound processing extracts embedded image payloads (data URLs and referenced CID images).
3. Each extracted image is persisted as file/document and associated to the ticket.
4. Original email MIME is stored as `.eml` and associated to the same ticket.

### Flow B — Threaded reply with embedded images

1. Email is matched to an existing ticket and creates a comment.
2. In-app inbound processing extracts embedded image payloads and persists them as ticket documents.
3. In-app inbound processing stores original reply email MIME as `.eml` on that ticket.

### Flow C — Duplicate/retry handling

1. Same inbound message is reprocessed due to retries or duplicate events.
2. Embedded images and `.eml` are not duplicated due to deterministic ids + idempotency keys.

## UX / UI Notes

- No new UI surface required.
- Files appear in existing Ticket Documents tab.
- Naming should make provenance clear:
  - Embedded images: deterministic filenames (for example `embedded-image-<n>.png` or hash-based name).
  - Source email: deterministic `.eml` filename derived from message id.

## Requirements

### Functional Requirements

- Extract `data:image/*;base64,...` payloads from inbound HTML body.
- Resolve `cid:` references in HTML and include only CID inline image parts that are actually referenced by the HTML.
- Ignore malformed/invalid embedded payloads without failing ticket/comment creation.
- Enforce file eligibility rules for extracted embedded images (image MIME only, existing max-size policy).
- Convert extracted embedded images into attachment-processing inputs and persist as ticket documents.
- Add dedicated original-email processing in the in-app inbound path that downloads/builds MIME bytes and persists one `.eml` document per inbound message.
- Use deterministic source-email filename format: `original-email-<sanitized-message-id>.eml`.
- Support provider-specific original-email MIME retrieval:
  - Gmail: retrieve raw message source.
  - Microsoft Graph: retrieve MIME source.
  - MailHog path: use available raw MIME source or deterministic fallback MIME assembly for test messages.
- Ensure strict idempotency for:
  - Embedded image document creation.
  - Original `.eml` document creation.
- Ensure failures in embedded-image and `.eml` persistence are recorded and do not block ticket/comment flow.

### Scoped Implementation Checklist (Phase 1)

This checklist is the current in-scope productionization slice for IMAP inbound payload handling in the in-app callback path.

1. Keep IMAP webhook callback path lightweight:
   - Authenticate and validate payload.
   - Invoke in-app inbound processing callback hooks either directly or via app-local in-process async worker, without requiring workflow-worker runtime.
   - Keep request latency bounded; avoid unbounded byte work in the request thread.
2. Add ingress caps before byte-heavy processing:
   - Cap per-attachment bytes.
   - Cap total attachment bytes per message.
   - Cap attachment count per message.
   - Cap raw MIME bytes for `.eml` persistence.
3. Include sufficient payload fields from IMAP service:
   - `emailData.rawMimeBase64` (when within cap).
   - `attachments[].content` base64 for eligible attachments.
   - `attachments[].isInline`, `attachments[].contentId`, `attachments[].id`, `attachments[].name`, `attachments[].contentType`, `attachments[].size`.
4. Run bounded in-app persistence with per-message processing limits:
   - Process regular attachments from provided bytes into ticket documents.
   - Extract and persist referenced CID/data-url images only.
   - Persist one original `.eml` document per message.
   - Process attachment artifacts sequentially (or strictly bounded) per message.

### Non-functional Requirements

- Keep processing tenant-safe and compatible with distributed table constraints (tenant-scoped reads/writes).
- Avoid unbounded memory growth while decoding embedded image payloads.
- Preserve deterministic behavior for retries and worker restarts.

## Data / API / Integrations

- Reuse `email_processed_attachments` idempotency table with synthetic attachment ids:
  - Embedded image ids (for example hash-based ids scoped to message).
  - One reserved id for source email `.eml`.
- Extend inbound email payload/type schemas as needed to carry fields already observed in adapters (for example `isInline`, optional inline content payloads for test path).
- Add provider adapter methods for original raw MIME retrieval where missing.
- Reuse existing storage/document association model:
  - `external_files`
  - `documents`
  - `document_associations`
- Ensure IMAP callback hook path carries enough payload data so in-app processing does not need workflow/event-bus handoff to complete artifact persistence.
- If using app-local in-process async worker mode, prefer durable queueing semantics (database-backed or equivalent) over memory-only queues to survive restarts and multi-instance deployments.

## Security / Permissions

- Persist all inbound-processor-generated files under system attribution (same as existing inbound attachment path).
- Restrict embedded extraction to image MIME payloads only.
- Sanitize generated filenames and content metadata before persistence.

## Observability

- No new monitoring/metrics scope in this plan.
- Existing warning/error logging patterns are sufficient for this phase.

## Rollout / Migration

- No new UI rollout required.
- Prefer no schema migration unless implementation proves current schemas cannot represent required fields.
- Behavior should apply to new inbound emails after deploy; no backfill required.

## Open Questions

Resolved:
- Persist only CID inline images that are referenced by HTML (`src="cid:..."`), and skip unreferenced inline CID parts.
- Use deterministic `.eml` filenames with the `original-email-<sanitized-message-id>.eml` convention.

## Acceptance Criteria (Definition of Done)

- New-ticket inbound email containing embedded images results in corresponding image documents on the ticket.
- Threaded-reply inbound email containing embedded images results in image documents on the existing ticket.
- Every processed inbound email creates (or reuses idempotently) one `.eml` document on the target ticket.
- Reprocessing the same inbound message does not duplicate extracted image documents or `.eml` documents.
- Embedded-image or `.eml` processing errors do not prevent ticket creation or reply comment creation.
- Inbound attachment + `.eml` behavior works in the in-app callback path without requiring workflow-worker processing.
