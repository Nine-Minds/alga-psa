# PRD — Email Attachments → Ticket Documents

- Slug: `2026-01-11-email-attachments-to-tickets`
- Date: `2026-01-11`
- Status: Draft

## Summary

When an inbound email (new ticket or reply) includes attachments, automatically store those attachments in Alga file storage and associate them as Documents on the relevant ticket.

## Problem

Today, inbound email processing detects attachments and calls `process_email_attachment`, but the current action implementation only creates a document association record (metadata) and does not reliably download and store the actual attachment content in Alga’s file storage. This leaves tickets without usable attachment files.

## Goals

- For **new tickets** created from inbound emails: attach all eligible email attachments as ticket documents.
- For **replies** that thread onto an existing ticket: attach all eligible email attachments as ticket documents.
- Make attachment ingestion **idempotent** (safe across webhook duplicates, workflow retries, and worker restarts).
- Support both **Microsoft Graph** and **Gmail** providers.

## Non-goals

- Inline image rendering inside the email/comment body (CID embedding) beyond storing the files as documents.
- Antivirus scanning, DLP, or content moderation (unless explicitly requested).
- Rewriting or re-architecting the document system beyond what’s required to store and associate attachments.

## Users and Primary Flows

### Flow A — New ticket from inbound email w/ attachments

1. Email arrives and is converted into a ticket.
2. Attachments are downloaded from the email provider.
3. Each attachment is stored in `file_stores` and linked to a `documents` record.
4. Each document is associated to the ticket (`document_associations`).

### Flow B — Reply email threaded onto existing ticket w/ attachments

1. Email reply arrives and is added as a ticket comment.
2. Attachments are downloaded and stored as above.
3. Documents are associated to the existing ticket.

## UX / UI Notes

- Ticket Documents UI already exists; newly attached documents should appear there without additional UI changes.
- (Optional) If feasible, include the source email metadata (provider/messageId) in document details for traceability.

## Requirements

### Functional Requirements

- Download attachment content for Microsoft/Gmail based on `emailData.id` (message id) and `emailData.attachments[].id` (attachment id).
- Create a stored file entry in Alga storage for each attachment and link it to a `documents` row.
- Associate each created document to the ticket.
- Enforce a maximum attachment size of **100 MB** (100 * 1024 * 1024 bytes).
- Allow all file types (no extension/mime blocklist).
- Skip inline/CID attachments by default.
- Use the system user as the uploader/creator for attachment-ingested documents.
- Strict idempotency: repeated processing of the same `{tenant, providerId, emailId, attachmentId}` must not create duplicates, even across retries and worker restarts.
- Failure handling: attachment failures must not prevent ticket creation / comment ingestion; errors should be recorded for later troubleshooting.

### Non-functional Requirements

- Avoid large memory spikes (attachment downloads can be big); apply safe limits.
- Ensure all writes on Citus distributed tables include `tenant` where required to avoid scatter/gather and tenant RLS issues.

## Data / API / Integrations

### Microsoft Graph

- Need a reliable “download attachment bytes” API call per attachment id.
- Must handle different attachment types (e.g. file attachments vs item/reference attachments); skip unsupported types initially.

### Gmail

- Need to call Gmail “get attachment” API using the message id + attachment id.

### Storage / Documents

- Persist bytes via the existing storage layer (`file_stores` + backing provider).
- Create `documents` rows pointing at the stored `file_id`.
- Create `document_associations` rows linking to the ticket.

## Security / Permissions

- Uploader/creator attribution: **system user**.
- Attachment filtering rules:
  - max size: **100 MB**
  - blocked mime types / extensions: **none**
  - inline/CID: **skipped by default**

## Rollout / Migration

- Add a new idempotency table for attachment ingestion (`email_processed_attachments`) with a unique constraint on `{tenant, provider_id, email_id, attachment_id}`.
- Backfill is not required initially; new inbound emails should work after deploy.

## Open Questions

Resolved:
1. Inline/CID attachments: **skip by default**.
2. Max attachment size: **100 MB**.
3. File type policy: **allow all**.
4. Uploader attribution: **system user**.
5. Idempotency/audit: **strict**, via `email_processed_attachments`.

## Acceptance Criteria (Definition of Done)

- Given an inbound email with 1+ attachments, the resulting ticket shows those files in the Ticket Documents section, and each document has a stored file in `file_stores`.
- Given a threaded reply email with attachments, the existing ticket gains those documents.
- Reprocessing the same email/webhook does not create duplicate documents for the same attachment.
- A failure to fetch/store an attachment does not prevent ticket/comment creation; the failure is recorded for debugging.
