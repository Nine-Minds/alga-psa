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
- Recipient-bound fallback routes bypass API-key middleware and enforce recipient verification plus current document permission; the revision supports account-free email-code verification.
- Review limitations and exact verification commands are recorded in REVIEW.md. The initial restart diagnosis fact was retired after mixed consumers and an orphaned Next child were discovered.

- Storage reads from notification consumers require explicit runWithTenant; request AsyncLocalStorage is absent. Added that scope and a behavioral regression assertion.
- Final checks: 85 focused tests, two real SMTP/subscriber tests, server typecheck, and shared/db/email package builds passed. The first-draft live event failed before SMTP logging; revision diagnosis and successful UI-to-SMTP recovery now supersede that unresolved state (see REVIEW.md). Original server/.env.local restored byte-for-byte.

## Review revision discoveries

- Portal global listing/folder/download actions previously omitted lifecycle authorization. A correlated tenant/public/ticket/client/board gate now runs before pagination and counts; direct/shared associations cannot bypass it. PostgreSQL bigint file sizes required numeric normalization for the actual global Documents UI.
- Portal Reply opened an editor but TicketDetails passed no callback, and its action accepted no parent. The UI now passes a reply handler; the action uses shared Comment.insert after public-parent validation. Thread drawer upload and cancel behavior also uses the tracked session.
- Resend 429 metadata was lost through provider/service boundaries. Confirmed non-deliveries now retry; ambiguous acceptance persists reconciliation state and never silently succeeds. Retry entries retain a processing lease/payload across worker interruption.
- Both server and package event buses globally deduplicated stable IDs before email-channel handling. Deduplication now includes channel; actual UI notifications reach SMTP.
- A synthetic tenant rate bucket contained about -2.2 million tokens. Repaired only that invalid bucket, then observed the UI PDF delivery retry succeed with attempts=2. Historical failure details were not recorded, so exact old provider outcome remains unknowable.
- Publication intent now persists with the comment in the existing scheduled recovery columns; shared model has no unawaited commit promise. Startup and per-tenant recurring PgBoss recovery redrive stable IDs. Failed individual tenants/comments do not stop other recovery work.
- Fallback contacts without accounts can request a ten-minute/single-use browser-bound email code. Same-origin referrers are necessary on the native verification form; file responses remain no-referrer/no-store. Current document permission is checked for email bytes and again for downloads.
- Cleanup stages deletion IDs, inspects all FK references, rechecks shared files under a lock before physical deletion, and retries failed storage work. Preserved shared rows leave the cleanup batch to avoid starvation. A real expired synthetic draft was removed by the periodic job.
- Revision evidence: 101 focused tests (29 PostgreSQL attachment tests), two package event-bus tests, package builds, server typecheck and production Next build. Live new/reply/edit/cancel/internal/portal/scheduled/video flows and actual MIME were checked; guest fallback delivered original 18 MB PDF bytes. Paid Resend/Graph and EE Temporal/Citus execution remain outside local verification; REVIEW.md records exact blockers.

- Final Redis lease tests use REAL_REDIS=1 to bypass the repository Redis stub and random key prefixes that are removed after each test. Two tests passed against Redis 6380. The registered dev-server PTY was stale; recreating the same service command produced session :2 and restored HTTP 200 on port 3653 with no smoke stream override.

## Round-2 targeted review

- Graph's named ErrorTooManyRequests did not match the send boundary's code allowlist. More deeply, MicrosoftGraphAdapter sanitization also discarded Retry-After. Preserve that header alone (not Axios config/tokens), classify HTTP 429 as rejected in the provider, and protect ambiguous acceptance independently of code spelling.
- recover-comment-publications was missing from the Temporal worker registry. It now uses the scheduled-comment forwarding pattern with strict event publication, and a behavioral worker → event → subscriber → server registration test covers it.
- Startup-only recovery schedule installation missed new tenants and never retried failed installations. Process-local one-minute discovery follows the existing RMM discovery pattern, starts before the first scheduler attempt, coalesces ticks and tracks only successful per-runner installations. Stable singleton keys are reused after partial failures. PostgreSQL tests cover new tenant discovery plus actual publication/cleanup recovery.

- Round-2 final verification: 118 focused tests plus 15 adapter/subscriber regressions pass; the 30-test attachment integration suite also passes after feeding the actual provider retry hint into the queue. Shared/email/Temporal worker builds, server and worker typechecks, and production Next build pass. No live Temporal cluster or paid Graph send was used. Development server still responds HTTP 200 on port 3653.

## Round-3 worker registration review

- Reproduced three boss.work registrations per handler over three discovery ticks through the real factory, initializer, registry and PgBoss runner. Asynchronous registration failure also incorrectly allowed discovery to proceed.
- Cache in-flight and successful application initialization per factory runner. Retain completed handler names across failed attempts and await PgBoss registration before marking a handler installed. Failed attempts retry; factory replacement gets fresh state. No attachment/schema changes.

- Six actual-path initialization regressions pass after failing before repair. Across focused runs, 74 distinct behavioral tests pass, including an isolated real PgBoss → committed publication → SMTP PDF recovery smoke. It registered 36 handlers once over three ticks, retried a failed publication with its stable ID, and delivered once. Smoke transport routing/storage use explicit seams; no new browser, paid-provider or live Temporal verification. Temporary PostgreSQL schema and committed fixture rows were removed.
- Jobs/shared/email builds, jobs/server/Temporal typechecks and the Temporal production build pass. Next production build uses isolated `.next-worker-review`; existing development environment and unrelated diffs are byte-identical.

- Final production Next build passed (exit 0), with warnings in unchanged workflow imports and dynamic rendering and separate passing server typecheck. Removed only its generated `.next-worker-review` output. Port 3653 returned HTTP 200; environment and unrelated diffs remain unchanged.

## Concurrent queue review follow-up

- Awaited registration exposed a same-queue race between separate schedule installers. PgBoss now shares one pending/successful registration promise per queue, clears rejection once for all waiters, and retries without recreating successful workers. Existing consumers read the latest successfully registered handler.
- Three new regressions failed before repair and pass afterward; all six initialization regressions remain. The independent reviewer reproducer and 47 focused tests including real PgBoss/SMTP recovery passed. A fourth new regression covers clearing cached worker registration on successful stop. No schema, attachment API or environment changes.

- Final server typecheck passed after the stop-cache cleanup. Production builds use isolated `.next-queue-review` to preserve the active dev output. The exact reviewer reproducer remains at its supplied /tmp location; only the temporary checkout copy was removed.

- Final production Next build passed after the stop-cache change; temporary output removed. Port 3653 is HTTP 200. Original environment and unrelated changes preserved and excluded from the local repair commit; no push or PR.
