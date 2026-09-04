# Discoveries

- Initial unrelated changes: package-lock.json and packages/migration-cli/bin/alga-migrate.mjs. Preserve and exclude from commit.
- Comment write paths: Comment model/actions (new/replies/edits), optimized add, legacy ticket add, client portal add/edit, REST add/edit. Scheduling publishes a committed comment with stable event identity. Bundling copies comments but must not grant attachment access on child tickets.
- Upload hook validates images only; TextEditor uses default BlockNote file insertion. uploadDocument validates via validateDocumentUpload and StorageService, inserts document + ticket association in a transaction, then generates previews.
- Document download/view/preview converge on authorizeAndRedactDocuments (legacy files route needs the same gate). Existing visibility alone cannot protect comment drafts/internal files. View/preview responses currently allow public caching.
- Email subscriber resolves intended recipients and rewrites ticket image URLs to CID. Provider capabilities include SMTP 25MB, Resend 40MB, Microsoft Graph simple attachments 3MB. Existing retry queue retains email params; attachment preparation and delivery dedupe must occur at the final send boundary so retries recheck eligibility.
- Publication calls in several comment actions occur inside transaction callbacks and need explicit after-commit registration.

- Local verification uses a schema clone named test_comment_attachments_draft; development data was not reset. The stack migration history references seven unavailable EE migration files, so only the named new migration was applied with history-list validation disabled.
- 85 focused tests and the shared build pass. New database tests include claim races, committed shared publication, model/REST replies and edits, and actual signed-download handler bytes/denials.
- Controlled GreenMail delivery verified original PDF bytes and per-recipient deduplication. The initial UI event used a boot-time subscriber with old code; the board dev-server service was restarted and health returned 200.
- Recipient-bound fallback routes must bypass API-key middleware and enforce session/recipient/document permission in the handler; this is now covered behaviorally.
- Review limitations and exact verification commands are recorded in REVIEW.md. The initial restart diagnosis fact was retired after mixed consumers and an orphaned Next child were discovered.

- Storage reads from notification consumers require explicit runWithTenant; request AsyncLocalStorage is absent. Added that scope and a behavioral regression assertion.
- Final checks: 85 focused tests, two real SMTP/subscriber tests, server typecheck, and shared/db/email package builds passed. Last fresh UI event nevertheless recorded failed delivery before SMTP logging; exact live cause unresolved (see REVIEW.md). Original server/.env.local restored byte-for-byte.
