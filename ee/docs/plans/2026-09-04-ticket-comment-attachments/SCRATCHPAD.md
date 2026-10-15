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

## Final work-order validation

- Verified plan history with the required main..HEAD command and both plan roots: no approved full-feature design exists; the existing PRD is retrospective and the work order remains authoritative.
- Existing unrelated package-lock and migration-CLI changes were fingerprinted before edits. Port 3653 belongs to this worktree; no process/environment or shared infrastructure override was made.
- Draft withdrawal now matches upload permissions (document:create, ticket:update and ticket access), while retaining tenant/actor/unclaimed-row restrictions. PostgreSQL regressions exercise refusal, successful cancellation and preservation of others' drafts and published documents.
- Authorization responses now annotate public comment lifecycle separately from the stored document visibility setting. Card/list badges and toggles use that gate, including memoized updates. Portal conversation controls wait for current-user loading.
- The inert executable was accepted by the existing explicit */* storage default. No approved restrictive file list supersedes that configurable Documents policy. Fixed the dropped asynchronous pre-validation rejection and MIME family prefix boundary; regression tests preserve PDF/video support and explicit unrestricted policy while rejecting unsupported types under a restrictive configuration.
- New live portal and MSP UI PDFs atomically attached to the correct comments on the original service. Portal cancellation tombstoned its unclaimed file. Both ordinary email events were acknowledged by consumer-209014 from the profile-preferences worktree, without attachment delivery rows. Redis MONITOR maps the ACK socket to that consumer; three other worktrees share the default group. This is reproducible environment routing interference, and this run cannot claim ordinary-stack attachment delivery success. Do not treat the earlier isolated-stream SMTP evidence as resolving it.
- New evidence: /tmp/alga-smoke-evidence/ticket-comment-attachments-final-20260905. Prior evidence remains supporting history only. Actual PgBoss/SMTP recovery passed in the new 51-test focused run; 108 additional regressions and two real Redis recovery tests passed. Transport/Temporal/storage seams in those tests remain explicitly mocked where documented by REVIEW.md.

- Final audit removed silent 100-ID cancellation truncation. The updated PostgreSQL case withdraws 101 owned drafts while preserving another actor and published rows; all 51 focused tests passed again, including a fresh real PgBoss/SMTP send.

- Follow-up GreenMail inspection confirms both ordinary UI events sent text-only notifications with zero attachments. Their consuming profile-preferences worktree has no attachment preparation in sendEventEmail. Version-mixed routing explains this observed failure; current attachment consumer execution remains unverified.

- Final frozen-source Next production build exited 0 after the cancellation correction. Server/types/storage checks passed; source hashes verified, isolated output removed, dev PID/environment preserved. One scoped follow-up commit updates existing PR #3332; ordinary UI-to-attachment delivery remains pending (T016) because default consumers run mixed code versions.

## Bundled notification repair

- Reproducing condition: child reply ticket ID is paired with the master comment ID. The managed attachment guard finds no matching comment and silently suppresses the whole email.
- Existing bundle mirrors copy note content but do not transfer attachment ownership. Keep master document authorization intact; use an explicit source context and validate the tenant-scoped bundle relation, mapping and public lifecycle before sending. No schema changes or document copies are needed.
- The first three actual subscriber regressions failed before the repair: each delivered the master email but suppressed the child. They now pass, including original PDF bytes and child reply-token identity.
- Added `commentSource` to retain the source publication across bundled child sends and serialized retries. Reply markers resolve the tenant-scoped child mirror, or omit comment ID for a bundle without a mirror. Attachment preparation, signed links and recipient ledger retain source identity and existing document authorization. No document associations are copied or widened.
- Destination authorization also revealed an obsolete clients.email fallback. It now matches ticket recipient selection from the default active client location; a contact-less child regression exercises this path.
- Final focused run: 68 behavioral tests passed (14 new bundle cases); one unrelated opt-in PgBoss smoke skipped. The actual subscriber/send/service/SMTP provider execute against migrated PostgreSQL with rollback fixtures. Six attachment delivery variants also send real SMTP to loopback GreenMail and inspect received MIME for exact bytes, child markers and no replay duplicates. Transport/provider discovery, storage bytes and signing secret are controlled seams; this is not a new UI/Redis or paid-provider smoke. A no-attachment control retains ordinary text notification behavior.
- Bundle guards cover internal/canceled/deleted source comments, private/canceled child mirrors, detachment and foreign tenants. Existing integration cases continue to cover shared storage, draft cleanup, signed-route revocation, provider queue recovery and ambiguous outcomes.
- Logs: /tmp/comment-bundle-before.log (three failing baseline cases), /tmp/comment-bundle-verification.log (68 passing tests and local SMTP checks), /tmp/comment-bundle-typecheck.log. The initial typecheck exhausted the default Node heap; rerun uses NODE_OPTIONS=--max-old-space-size=12288.

Final server typecheck passed with the larger heap, including a final-source recheck. `git diff --check` passed. The pre-existing package-lock and migration CLI diffs remain byte-identical and are excluded from the repair. Local evidence is summarized in `/tmp/comment-bundle-evidence/result.json`; no service or environment configuration was changed.

### Bundled-child guard and live verification follow-up

- Preflight was already at pushed `dfc618e264`; reproduce the reported `b04f08e62d` through isolated source-module aliases, without swapping files under the live server. Expected two notifications, observed master only.
- Reject a supplied child reply comment that disagrees with the tenant-scoped mirror. Disabled or restricted mailbox accounts must not fall through to guest child-recipient access. Both guards failed before the follow-up and pass now.
- The focused fixture-driven live smoke uses the T016 normal Enterprise startup/routing method, but does not reopen its UI acceptance. Exclusive branch consumer, original/replay ACKs, exact PDF MIME, child markers and sent-once source ledgers are recorded in REVIEW.md.
- Next interprets an absolute-looking NEXT_DIST_DIR under server in this checkout. Use a relative output symlink backed by `/tmp`, with a parent node_modules symlink, to avoid filling the worktree filesystem. Preserve the active `.next/dev` cache and original PID.
- GreenMail's message-list route has no DELETE operation. Remove only the newly created controlled mailbox after checking every message belongs to this run; archive MIME first.
- Original port 3653 temporarily stopped responding while its terminal output was paused. `alga-dev terminal-send-keys` with Ctrl-Q on the existing card-service session restored HTTP 200 with PID 122926 unchanged; no restart or environment change.
- Production webpack separately writes `server/node_modules/.cache/webpack`, regardless of NEXT_DIST_DIR. Its 7.2 GB filled the worktree after successful compilation; move that inactive production cache to `/tmp` too before rerunning. The live Turbopack cache remains untouched.
