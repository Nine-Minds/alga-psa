# Draft implementation review

The work order is the primary specification. No approved full-feature design plan exists in this checkout; see PRD.md. This draft is separate from mitigation card 4e6f8956-4609-49e9-90a7-6daaf858983b and PDF-link PR #3319. No delivery date is promised.

## Inspect first

1. Authorization: `shared/lib/ticketCommentAttachments.ts`, document action authorization, portal/REST lists, legacy file access, the signed download handler and middleware exemption. Managed documents require the original document policy AND current lifecycle/ticket/client eligibility. Existing unrelated documents are never adopted or made public. The public tenant-logo shortcut excludes managed attachments.
2. Lifecycle: new migration, server-owned uploads, locked reconciliation inside comment transactions. Review model, MSP/optimized, portal, REST and shared workflow/inbound entry points. A document can belong to one comment; simultaneous claims serialize. Ticket document associations remain. Withdrawal leaves tombstones and never deletes shared content. Failed document transactions clean up only their newly uploaded, unclaimed storage file.
3. Email retries: `ticketCommentAttachmentEmail.ts`, `sendEventEmail.ts`, provider capabilities and rate-limit handling. Each attempt reloads current public comment attachments. Delivery ownership is per tenant/comment/normalized recipient; known non-delivery can retry, sent recipients cannot repeat, and ambiguous outcomes remain `sending` for manual reconciliation. Rate limits use the event retry queue rather than retaining rendered attachments in the delayed email queue.

## Implemented lifecycle

- New/reply/edit uploads use the document storage validation pipeline. Images remain inline; PDFs/videos/other supported files use file blocks. No embedded PDF/video viewer.
- Drafts last 24 hours and are owner-only. Cancel withdraws tracked drafts; abandoned/untracked editor drafts expire by policy even before housekeeping runs. A subsequent upload tombstones expired rows. Physical document/storage retention is intentional, protecting shared content.
- Create/edit claims only same-tenant/ticket, unexpired, actor-owned drafts within the comment transaction. Removal, deletion and canceled schedules revoke access. Thread/comment visibility is checked at read/send time. Returning public visibility does not resend previously delivered files.
- Uploads and edits send no customer notification. Initial public publication includes only that comment's files; inline images are deduplicated by document ID. Per-provider encoded-size allowance and Resend extension restrictions produce recipient-bound, one-hour signed links where necessary.
- Scheduled comments retain attached rows but are inaccessible to clients until publication. Existing scheduled event identity/recovery remains in use. Immediate MSP/portal publication occurs after commit. Shared inbound outbox writes stay transactional; other shared publishers await Knex executionPromise commit.

## Verification

- Migration applied to the local development database on port 5472. Normal migration-history validation was blocked by seven historical EE filenames present in this shared stack but absent from the checkout; only this named migration was applied with history-list validation disabled. The isolated database `test_comment_attachments_draft` was created from the migrated development schema; no development database reset.
- 85 focused tests passed across nine files. New PostgreSQL suite covers exact PDF association, model and REST new/reply/edit behavior, ownership/expiry/tenant/client boundaries, concurrent claims, commit-time publication, visibility/scheduled/deleted policies, canonical document authorization, shared-content preservation, actual MIME bytes, unrelated-file exclusion/CID deduplication, provider fallback, authenticated signed-download bytes/expiry/revocation, and per-recipient partial-delivery state.
- Existing image upload hook, InlineReplyComposer, document permissions, SMTP provider, shared contact-authorship, Documents REST upload and middleware tests pass.
- Local UI on port 3653: synthetic ticket ATT-SMOKE-fcfd3bf2; uploaded comment-smoke.pdf, observed it in Documents and composed comment, submitted public comment and verified the claimed row in PostgreSQL. Customer data was not used.
- Actual GreenMail SMTP capture: current-source sendEventEmail delivered one original PDF to attachment-recipient@example.test; decoded MIME includes PDF bytes and filename in body. Repeating the same send produced no duplicate. Both opt-in SMTP smoke tests pass separately, including the actual ticket notification handler without request tenant context.
- Live unsigned fallback HTTP request reaches the session-aware handler and returns 401. Signed route behavior is tested with real database policy and controlled auth/storage seams.
- Shared, database and email package builds passed. Final server typecheck passed with NODE_OPTIONS=--max-old-space-size=12288; the default heap was insufficient.

Focused tests from server:

```sh
TEST_DB_NAME=test_comment_attachments_draft DB_HOST=127.0.0.1 DB_PORT=5472 npx vitest run src/test/integration/ticketCommentAttachmentsIntegration.test.ts src/test/unit/api/ticketDocumentUpload.service.test.ts src/test/unit/documentPermissionUtils.test.ts ../shared/models/__tests__/ticketModel.createComment.contactAuthorship.test.ts src/test/unit/notifications/ticketCommentInlineImageEmail.test.ts ../packages/ui/src/components/InlineReplyComposer.test.tsx ../packages/tickets/src/components/ticket/useTicketRichTextUploadSession.test.tsx src/test/unit/middleware.apiKeyAuth.test.ts ../packages/email/src/providers/__tests__/SMTPEmailProvider.test.ts
```

## Limitations and follow-up review

- Fallback recipients must have an active matching portal/MSP account and document permission. Contacts without portal accounts cannot redeem links. External watcher addresses without established tenant/client eligibility receive no attached files. A verified recipient flow for contacts without accounts is unfinished.
- Immediate after-commit event publication still uses the repository's best-effort hooks, not a new durable outbox. A crash between commit and publication can lose a notification. Scheduled/inbound durable publication mechanisms remain intact.
- Ambiguous provider acceptance has no automatic reconciliation UI/job; the delivery ledger deliberately prevents blind resends. A permanently disabled provider also needs intervention. SMTP connection/auth/rejection failures are classified as definitely not delivered; timeouts after DATA remain uncertain.
- Internal attachments are not embedded in notification email, including staff email. Staff text notifications are retained; file access remains in the authenticated application.
- No physical garbage-collection job or periodic draft sweep is added. Removed files remain stored; only upload-triggered housekeeping changes expired rows to tombstones. No automatic attachment email on edits or public visibility changes.
- Another worktree shares this stack's database, Redis streams and consumer group; initial UI events were consumed by older code and sent without files. An isolated stream exposed the storage tenant-context issue, which was fixed. Current-source SMTP and subscriber delivery pass, and the isolated event pending queue drained after the actual old Next child was stopped and the service relaunched. Original local environment configuration is restored at completion. Portal/edit/reply/cancel/scheduled/video UI paths are not claimed as fully smoke-tested.
- The last fresh isolated UI publication (comment-final-live.pdf, comment f22db364-6c5e-4edf-8ce3-b266b8ab24ae) reached the delivery ledger in `failed` state without an SMTP log or captured message. The event was acknowledged and no retry entry remained when inspected. The exact live-service failure remains unresolved; this is NOT a passing UI-to-email end-to-end result. Inspect live provider/rate-limit handling and event retry processing first. Direct current-source SMTP and full notification-handler tests deliver the other synthetic PDF correctly.
- Actual scheduled job execution and the portal action matrix have policy coverage but no complete end-to-end test. No production Next build, Resend/Graph delivery or Citus-distributed migration was run. Provider limits are exercised with controlled capabilities, not paid external sends.
