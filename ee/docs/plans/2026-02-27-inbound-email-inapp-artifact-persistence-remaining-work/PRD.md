# PRD — Inbound Email In-App Artifact Persistence (Remaining Work)

- Slug: `2026-02-27-inbound-email-inapp-artifact-persistence-remaining-work`
- Date: `2026-02-27`
- Status: Draft

## Summary

Close the remaining gaps so inbound email artifact handling is fully supported by **in-app callback-hook processing** (direct or app-local async worker), without requiring workflow-worker/event-bus execution for core artifact persistence.

Artifacts in scope:
1. Standard email attachments become ticket documents with persisted file bytes.
2. Referenced embedded images (`data:image/...` and HTML-referenced `cid:` images only) become ticket documents.
3. Original inbound email source is persisted as a deterministic `.eml` ticket document.

## Problem

Current in-app inbound processing creates tickets/comments, but artifact persistence behavior is incomplete/inconsistent versus target behavior:
- Attachment processing in in-app path is metadata-centric and does not reliably persist file bytes as full ticket documents.
- Embedded image extraction/persistence is not executed in the in-app path.
- Original email `.eml` persistence is not executed in the in-app path.
- IMAP webhook path is still event-bus handoff oriented and not aligned with in-app callback processing parity.

## Goals

- Ensure in-app inbound processing (new ticket and reply paths) persists all in-scope artifacts.
- Keep artifact persistence best-effort and non-blocking for ticket/comment creation.
- Maintain deterministic idempotency for retries/duplicates.
- Support IMAP callback execution in the in-app model with bounded processing and payload caps.
- Keep CPU/memory usage bounded during base64 decode and artifact conversion to avoid request-thread starvation.

## Non-goals

- Rebuilding document UI.
- Rewriting comment HTML to hosted image URLs.
- Persisting unreferenced inline CID parts.
- Introducing external workflow-worker or event-bus dependency for primary artifact persistence.
- Full distributed queue platform work (external brokers, multi-service orchestration).

## Decisions (Locked)

- Persist only CID inline images that are actually referenced by HTML (`cid:` links).
- Use deterministic source-email filename format: `original-email-<sanitized-message-id>.eml`.
- App-local in-process async worker mode is allowed.

## Users and Primary Flows

### Flow A — New inbound email (Google/Microsoft/IMAP)

1. In-app callback receives/fetches normalized email payload.
2. Ticket is created.
3. Attachment, embedded image, and `.eml` artifacts are processed and attached as ticket documents.
4. Any artifact failure is logged/recorded without rolling back ticket/comment creation.

### Flow B — Reply to existing ticket

1. In-app callback resolves thread/reply token and creates comment.
2. Artifact pipeline persists attachments, referenced embedded images, and `.eml` to the matched ticket.
3. Duplicate delivery remains idempotent.

### Flow C — Duplicate/retry ingress

1. Same message arrives again.
2. Ticket/comment dedupe remains intact.
3. Artifact persistence dedupes on deterministic keys (no duplicate document rows for same source artifact).

## Requirements

### Functional

- Extend in-app processing to run a unified artifact pipeline after ticket/comment creation for both new and reply flows.
- Accept attachment bytes in callback payload when available (`attachments[].content` base64) and persist actual files/documents.
- Reuse/expose embedded image extraction for in-app path:
  - `data:image/*;base64,...` extraction,
  - referenced `cid:` mapping to inline MIME parts,
  - skip unreferenced CID inline parts.
- Persist one `.eml` document per inbound message in in-app path using available MIME source fields (`rawMimeBase64`/`sourceMimeBase64`/`rawSourceBase64`) or deterministic fallback assembly when required.
- Apply idempotency to each artifact class:
  - provider attachment,
  - extracted embedded image,
  - original email `.eml`.
- Wire IMAP webhook path to in-app processing mode with event-bus fallback only when explicitly configured.

### Safety / Performance

- Enforce ingress caps for IMAP payload processing:
  - per-attachment max bytes,
  - total attachment bytes,
  - attachment count,
  - max MIME bytes for `.eml` persistence.
- Keep byte-heavy work off the request critical path when async mode is enabled (app-local worker queue).
- Bound per-message artifact processing concurrency to prevent memory/CPU spikes.

### Data / Contract

- Normalize/validate inbound payload fields needed by in-app artifact pipeline:
  - `attachments[].id|name|contentType|size|contentId|isInline|content`,
  - `rawMimeBase64`/`sourceMimeBase64`/`rawSourceBase64`,
  - `ingressSkipReasons`.

## Acceptance Criteria

- In-app processing path (without workflow-worker) can ingest inbound email and produce ticket documents for:
  - regular attachments,
  - referenced embedded images,
  - original `.eml`.
- Reprocessing the same message does not duplicate artifact documents.
- Oversize/over-limit artifacts are skipped with structured reasons while ticket/comment ingestion still succeeds.
- IMAP callback path supports in-app processing mode and honors caps.

## Risks

- Large base64 payloads may exceed request/body limits if not capped early.
- Byte decoding in request thread can degrade latency under burst conditions.
- Mixed provider payload shapes can cause subtle artifact loss if contract normalization is incomplete.

## Rollout

- Gate IMAP in-app artifact processing behind env/feature flags.
- Start with controlled tenants/providers, then expand.

## References

- Existing plan baseline (superseded for remaining-scope tracking):
  - `ee/docs/plans/2026-02-27-inbound-email-embedded-images-and-original-eml/`
