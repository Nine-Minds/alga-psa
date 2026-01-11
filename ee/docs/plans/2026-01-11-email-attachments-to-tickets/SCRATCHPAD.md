# Scratchpad — Email Attachments → Ticket Documents

## Context / Current State

- The email workflow already attempts attachment handling:
  - `services/workflow-worker/src/workflows/system-email-processing-workflow.ts` calls `actions.process_email_attachment` for both new tickets and replies.
- The registered action `process_email_attachment` resolves to:
  - `shared/workflow/init/registerWorkflowActions.ts` → `@alga-psa/shared/workflow/actions/emailWorkflowActions#processEmailAttachment`
- Current `processEmailAttachment` implementation creates a `documents` row and a `document_associations` row, but does **not** download/store attachment bytes in `file_stores`.

## Key Files

- Workflow (worker): `services/workflow-worker/src/workflows/system-email-processing-workflow.ts`
- Action registration: `shared/workflow/init/registerWorkflowActions.ts`
- Email workflow actions: `shared/workflow/actions/emailWorkflowActions.ts`
- Email message interface includes `attachments[]` metadata only: `shared/interfaces/inbound-email.interfaces.ts`
- Microsoft message details expands attachment metadata: `shared/services/email/providers/MicrosoftGraphAdapter.ts`
- Gmail adapter exists in server (not shared): `server/src/services/email/providers/GmailAdapter.ts`
- Storage layer (server): `server/src/lib/storage/StorageService.ts`, `server/src/models/storage/FileStoreModel`

## Notes / Decisions (draft)

- Policy decisions (confirmed):
  - Inline/CID attachments: skip by default
  - Max attachment size: 100 MB (100 * 1024 * 1024 bytes)
  - File types: allow all (no blocklist)
  - Attribution: system user
  - Idempotency: strict, via `email_processed_attachments`

- Likely need to implement provider-specific “download attachment bytes” methods for Microsoft and Gmail.
- Need attachment-granularity idempotency (not just message idempotency), because workflows can retry per-event.
- Citus: treat any writes/updates to distributed tables as requiring `tenant` in the predicate to avoid scatter/gather and tenant RLS issues.

- Implementation gotcha: `server/src/lib/storage/StorageService.ts` currently requires an authenticated user (`getCurrentUser`) even when an explicit `uploaded_by_id` is provided. For system-ingested email attachments, we likely need a system-upload path that bypasses interactive auth and writes `external_files` directly (similar to `server/src/services/zip-generation.service.ts`).

## Open Questions to Resolve

- Remaining:
  - Exact schema for `email_processed_attachments` (status enum, document/file ids, error storage).
  - Microsoft: handling of non-file attachments (item/reference); likely skip initially.
