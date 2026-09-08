# Ticket comment attachments with email delivery

No approved full-feature plan was found by `git log main..HEAD --name-only -- docs/plans/` or searches of both plan roots. The implementation specification is the work order for alga-2026-0002348. Supporting plans cover clipboard images (2026-03-01), threaded comments (2026-05-13), and scheduled publication (2026-08-21).

Upload supported documents while composing new comments, replies, and edits. Keep images inline; files are downloadable links, without embedded PDF/video viewers. Persist server-owned drafts in a tenant-scoped lifecycle table and atomically claim/reconcile them within each comment transaction. Keep ticket document associations. Only published public attachments of the exact comment may reach customers. Enforce current comment, thread, ticket/client, and tenant eligibility for document reads and email fallback links. Never adopt an unrelated preexisting document or widen its visibility.

Publication must happen after commit. Uploads and edits alone never send email. Recipient delivery state must survive partial failures and retries. Limits use the existing outbound provider infrastructure; files that exceed limits use short-lived signed links bound to a signed-in recipient and current access. Cancel/abandon/remove withdraw access without deleting shared storage. An indeterminate provider outcome must not cause automatic duplicate sends.

Acceptance: behavioral database tests for claim races, ownership, visibility, lifecycle, shared content, exact email selection, CID deduplication, limits/link expiry and recipient binding, plus focused UI/email smoke on the local stack and applicable typechecking. Report any incomplete coverage or behavior explicitly.

Review repair acceptance: recurring discovery reuses successful runner initialization, coalesces concurrent initialization, and retries failures without recreating workers registered before a partial failure. Preserve the factory lifecycle and existing tenant schedule discovery; no schema or attachment API changes.

Concurrent recurring schedule installers must share per-queue worker registration, observe the same failed attempt, and retry without duplicating successful workers.

Final validation corrections retain upload-equivalent permissions for draft withdrawal, show effective comment visibility in Documents controls, gate portal composition on loaded identity, and enforce the existing configured MIME/size policy without asynchronous validation gaps. Shared-stream runtime delivery requires consumers from this implementation; mixed-worktree smoke is not delivery acceptance.

Bundled notification repair: keep the source comment/attachment identity separate from the child ticket reply destination. Resolve any mirrored reply comment from tenant-scoped bundle mappings, and revalidate the bundle and public source/mirror on retry. A bundle never grants access to master documents: existing source document authorization controls bytes and fallback links. Child requesters retain public text notifications even when source files are not authorized. Preserve source-comment recipient deduplication.
