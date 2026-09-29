# Documents reload repair — 2026-09-05

Review the initial document filtering/counts in `optimizedTicketActions.ts` first, then the same-ID metadata path through `TicketDetails`, `TicketDocumentsSection`, and `Documents`.

## Specification and scope

The work order is the specification. The required `git log main..HEAD --name-only -- docs/plans/` and searches of both plan roots found no approved full-feature attachment plan. This directory's PRD/REVIEW are retrospective work-order records, not approval. The separate File-menu mitigation and PDF-link PR #3319 are unchanged.

Preflight: branch `feature/support-ticket-comment-attachments-with-email-de`, tracking the same branch on `origin`; local and PR #3332 head `1ccc405311dc54810b54b359329cb80d43404636`. The only pre-existing changes were `package-lock.json` and the migration CLI. Port 3653's current PID was 839208, with cwd in this worktree's `server`; its environment SHA-256 was `2dc87c345da80de20c87316faa9443aeefef423e5545e6b7ea6ceef463256e7a`.

## Repair

- The consolidated ticket action checks document read permission and calls the existing `authorizeAndRedactDocuments` before returning documents or deriving counts. Ticket authorization still runs first. The shared policy supplies document authorization, lifecycle exclusion and effective comment publicity; there is no new policy or UI-only exclusion.
- Initial loading is unpaginated. Subsequent entity pagination and document totals already use the shared authorization path. Regression tests compare initial membership with those totals and multiple pages, including removed rows that sort first.
- Successful comment creation, reply and edit refresh ticket documents after claim/reconciliation. Upload-time refresh alone returned draft metadata before the comment transaction.
- `TicketDocumentsSection` now accepts changed rows with unchanged IDs. `Documents` consolidates prop synchronization and search into one effect, including totals. Its previous search effect already refreshed metadata; the section's ID-only gate and missing post-save refresh were additional causes found during live verification.

No schema, cleanup model, email/provider policy, source/bundle authorization, image behavior or standalone upload flow changed. Active drafts retain the existing unexpired-owner-only policy. One obsolete source-string assertion requiring redaction of the unannotated row was removed; the new regressions exercise behavior.

## Original repair verification (commit 3c41889)

Original focused run: **98 passed, one opt-in PgBoss/SMTP recovery case skipped**, across nine files. The final database suite was rerun after adding standalone authorization coverage: **55 passed, one skipped**. Fixtures use migrated PostgreSQL with transaction rollback; session/RBAC and connection binding are controlled seams. The actual consolidated action, document authorizer, lifecycle queries, counts and pagination execute. Coverage includes public/internal attachments, removed/expired/other-owner drafts, standalone documents, denied document permission and client/tenant access. Existing attachment tests cover portal download/preview denial, board restrictions, bundle/source eligibility and email replay/recovery. Component tests exercise all four save paths and the real section → Documents → storage-card metadata transitions.

Original port 3653 smoke used actual application upload and save handlers: internal PDF submission, a second PDF upload followed by cancellation, standalone Documents upload, full ticket reload and same-ID visibility edits in both directions. Three cards remain after reload; the internal file shows Internal with a disabled toggle, and the canceled file is absent. Public content was a database fixture, with no publication event. File inputs received browser `File`/`DataTransfer` events because algadev cannot select native files.

Authenticated portal ticket/global listings exclude internal and canceled files. Both files return download/view 403 and preview 404. Public download/view return 200 and the original 638 bytes. PDF thumbnail generation still fails locally, as it did before this repair. No new image or email delivery acceptance claim is made: existing regression coverage and the prior smoke report remain the evidence for those unchanged paths. No temporary Redis routing or additional app instance was used. Customer delivery rows, email logs and the unique recipient mailbox remain absent after cancellation and edits.

Evidence: `/tmp/alga-smoke-evidence/documents-reload-repair-20260905/`, especially `reload-assertions.json`, `03-full-reload-pass.png`, `metadata-internal.json`, `metadata-public.json`, `portal-access.json`, `final-state.json`, and the test/build logs. The earlier failing reproduction is `/tmp/alga-smoke-evidence/ticket-comment-attachments-20260905T0435/REPORT.md` and screenshots 17–18.

## Original repair builds and preservation

Affected Nx builds passed for documents/tickets and 24 dependency tasks (`packages-final.log`). These two feature packages use source transpilation/no-op Nx build targets, so the successful server typecheck and production webpack build provide their compilation checks. The final Enterprise production build exited 0, including all 74 static pages (`production-build-final.log`, `build-exit.json`). Next skips type checking during that build; the separate `npm -w server run typecheck -- --tsBuildInfoFile ...` exited 0. Existing scheduling-export, workflow-import, cache-size and dynamic-rendering warnings remain.

The first build attempt inherited the running dev process's `TURBOPACK` setting, conflicting with `--webpack`; the isolated build environment then omitted that setting. A later attempt hit `/tmp` write quota with a 7.2 GB webpack cache despite free space reported by `df`. The final build used `NEXT_DIST_DIR=.next-documents-reload-build` linked to dedicated `/tmp` output, with only its webpack cache moved to `/home/robert/documents-reload-webpack-cache`, where 124 GiB was free. The failed attempts are not acceptance results. Both output/cache directories and their links were removed after success. The running process environment was never changed.

The final full reload also passed (`08-final-reload-pass.png`). Cleanup verified zero remaining synthetic ticket/contact/comment/thread/lifecycle/document/association/storage/audit records and zero physical storage files. The unique customer mailbox never existed; no synthetic mail needed removal. No temporary routing was installed. The card's browser is restored to the original synthetic MSP identity and ticket list. PID 839208, its cwd/environment hash, and the unrelated lockfile/migration CLI patches remain unchanged; port 3653 is healthy. `cleanup.json` and `preservation.json` record the final checks.

Live Graph/Resend, Citus, Temporal, image re-upload and fresh public email delivery were not retested for this read/refresh repair. Existing email regressions were reused; no mixed-stream delivery was attributed to this branch.

## Review follow-up — 2026-09-05

The review reproduced two blockers at `3c41889`: the Documents test imported Tickets, and T039 failed under seed `1788586298669`. The follow-up keeps all Documents-only tests in `Documents.drawer.test.tsx` and moves the real section → Documents → storage-card integration into `server/src/test/unit/documents/ticketDocumentsMetadata.test.tsx`. No cycle baseline or lint suppression was added.

CI also identified the initial action's direct Tickets → Documents authorization import (ESLint job `101255608063`). The existing authorization implementation and its private helpers now live in `shared/lib/documentAuthorization.ts`; both initial loading and document actions call that function. The existing async document action entry point remains compatible. The moved implementation is byte-identical (`authorization-extraction.json`), including tenant/client relationships, bundle narrowing, redaction and attachment lifecycle/publicity. Existing source-contract readers follow the relocated code; behavioral coverage remains the acceptance criterion.

T039 was a startup-sensitive mock problem: `useRouter` and `useTranslation` returned new router/translator identities on every render, changing callbacks that schedule the 200 ms remote-update debounce. Asynchronous mount renders could reset that timer before the assertion. Their mocks now keep those identities stable, matching provider behavior. No production debounce or live-update behavior changed.

### Fresh follow-up checks

- The exact review command failed before edits: **1 failed / 23 passed**, with `ticket-info-status-take` absent. After the fix, that same command passed **23/23 twice**. The moved composition test retains the 24th test in server. With seed `1`, all three component files pass **24/24**. The same three files also pass **24/24** with the root Vitest 4.1.10 runner and the review seed (the requested server command uses Vitest 3.2.7 locally).
- In a detached checkout of pre-repair `1ccc405311`, T039 alone fails with the same absent element; the same isolated test passes after the fix. The baseline full pair passes 18/18 because the older seven-test remote suite has a different shuffle order. This is evidence of a pre-existing startup-sensitive test, not a claim that the exact full baseline command fails.
- Focused authorization, attachment and UI coverage: **99 passed, one existing opt-in PgBoss/SMTP case skipped across 11 files**, using seed `1788586298669`. The PostgreSQL integration suite executes the actual optimized initial action, shared authorizer, lifecycle metadata/counts/pagination and portal denial assertions with transaction rollback.
- Fresh ESLint over changed production/component sources: **0 errors** (existing warnings remain). Fresh server typecheck: **exit 0**. Fresh affected Nx builds: **two projects plus 24 dependency tasks passed**.
- Nx graphs before/after show the Documents → Tickets edge removed. The cycle checker still exits 1 solely for `server → temporal-workflows`, which the detached pre-repair graph also reports. The final graph has four cycles versus the same four before the repair; three are already in the repository's unchanged baseline. This is not a globally passing cycle gate.

Evidence for this follow-up is `/tmp/alga-smoke-evidence/documents-reload-review-20260905/`: seeded before/after logs, isolated baseline T039, `focused.log`, `ui-seed-1.log`, graph exports/comparison, extraction proof and CI logs. The original live reload/upload/cancel/portal evidence above is historical evidence from `3c41889`; it was not rerun as a fresh upload/email smoke in this follow-up. UI behavior and delivery policy are unchanged; the fresh database regressions exercise the relocated authorizer.

### Current CI findings for reviewed commit 3c41889

Snapshot taken during this follow-up; these are results of the reviewed commit, not the forthcoming follow-up commit:

- `101255607813`, circular dependencies: Documents → Tickets (fixed here) and server → Temporal (also present at `1ccc405311`). No baseline was changed.
- `101255608063`, ESLint: initial Tickets → Documents import (fixed by sharing the unchanged authorizer).
- `101255607944`, Nx affected typecheck: `packages/event-bus/src/commentPublication.channels.test.ts:17` calls the private `EventBus` constructor. Both the test and constructor are unchanged since pre-repair `1ccc405311`; this is separate from the passing fresh server typecheck.
- `101255672328`, tenant schema: three feature tables are absent from the Temporal tenant-deletion order: `ticket_comment_attachment_challenges`, `ticket_comment_attachments`, and `ticket_comment_email_deliveries`. The omissions are verified in pre-repair source; no schema or deletion-model change is included here.
- `101255608018`, translations: Portuguese `common.json` lacks `editor.attachFiles`, `editor.uploadingFiles`, and `editor.fileUploadFailed`, also verified before this repair in the original evidence.
- `101255608092`, Nx affected unit tests: Tickets, client-portal and Billing tasks failed. The selected seven ticket files produce the same **4 failed / 32 passed plus one unhandled error** before and after this repair under the server config; this is a targeted comparison, not a reproduction of the full Nx job. The six portal failures also reproduce before this repair. Full Billing/CI isolation has not been established; no blanket claim that all CI failures are pre-existing is made.
- `101255607669`, EE workflow build guard: Next exits 134 after JavaScript heap exhaustion. The fresh isolated production build result for this follow-up is recorded separately below.

The repair's local checks do not imply PR-wide CI is green. Other integration, fresh-install and server-coverage jobs were still in progress at this snapshot.

### Follow-up production build and cleanup

The fresh Enterprise production webpack build completed with **exit 0**, including all **74 static pages** (`production-build.log`, `build-exit.json`). It used `NEXT_DIST_DIR=.next-documents-review-build` linked to `/home/robert/documents-review-build/output`, with the webpack cache separately linked under `/home/robert/documents-review-webpack-cache`. Disk checks showed 131 GiB free on the host before cache growth and 125 GiB during the build; the worktree retained 16 GiB free. This fresh result supersedes reliance on the original production build for the relocated helper. Existing webpack/workflow/dynamic-rendering warnings remain; Next's skipped type validation is covered by the separate passing server typecheck.

Both temporary output/cache directories and their links, plus the detached baseline checkout, have been removed. Fresh cleanup queries confirm zero original smoke records/storage files and no synthetic customer mailbox. No new live mail, attachment fixture, routing or app process was created by this follow-up. Database regressions rolled back their fixtures. Port 3653 still returns 200 with PID 839208, its original cwd and environment hash; the unrelated lockfile and migration CLI diffs are byte-identical. See `cleanup.json` and `preservation.json` in the follow-up evidence.


## Parent prop refresh mitigation — 2026-09-05

Inspect the new `TicketDetails` document prop effect and its failing-before rerender regression first. Preflight confirmed local HEAD, origin and PR #3332 already contained `6708e66f`. Shared initial authorization/counts, post-claim/edit refreshes and section/card synchronization were retained. The required plan-history command and both plan roots still identify no approved full-feature attachment plan; PRD/REVIEW remain retrospective records.

One remaining boundary reproduced: `TicketDetailsContainer` supplies fresh rows after `router.refresh`, but `TicketDetails` previously read documents only at mount. The behavioral test received `original.pdf` with internal metadata after the parent supplied the same ID as `renamed.pdf` with public metadata. `TicketDetails` now synchronizes changed document props, including removed membership, with a stable empty default so unrelated renders do not reset locally refreshed rows. No policy, schema, email/provider or cleanup implementation changed.

Fresh evidence: `/tmp/alga-smoke-evidence/documents-lifecycle-verify-20260905/REPORT.md` and adjacent logs/assertions/screenshots.

- `parent-before.log` records the failure. `focused.log` passes **90 behavioral tests**, one existing opt-in recovery case skipped, across seven files. Migrated PostgreSQL coverage retains initial public/internal/standalone/owner-draft/removed/expired/unauthorized membership, counts and pagination. Lifecycle/authorization queries are real; auth/RBAC, storage and event seams are controlled and database fixtures roll back.
- `seeded-pair.log` passes **24/24** with seed `1788586298669`; isolated `t039.log` passes. Stable translator/router mocks remain unchanged. The server composition test retains real section → Documents → storage-card coverage; no source-string test was added.
- Fresh authenticated MSP full reload retains exactly three cards/tile rows, internal badge/disabled toggle, canceled exclusion and public/standalone PDFs. Both public/internal edits update without reload. `parent-to-card-live.json` additionally proves a same-ID filename/publicity update through the actual Container → Details → bento tile → section → Documents → card flow. The observed application callback requests router.refresh and a window marker survives. Database metadata was controlled setup and restored afterward.
- Portal ticket/global listings retain public and exclude internal/canceled files. Denied download/view return **403**, preview **404**. Public download/view return **200/638 bytes**, SHA-256 matching the original. Public PDF thumbnail generation still fails locally; original-byte view/download work. See `portal-access.json`, `public-download-hash.json`, `reload-assertions.json`, metadata assertions and screenshots 01–05.
- Affected ESLint passes with warnings; separate server typecheck exits **0**. Nx documents/tickets builds plus 24 dependencies pass (14 tasks cached). These feature packages use source-transpiled/no-op build targets. The fresh graph excludes Documents → Tickets; cycle check exits **1** solely for server → Temporal, with output identical to the pre-repair graph check. No cycle baseline changed.

The smoke used original PID **839208** on **3653**, one synthetic ticket/contact, a database/storage public fixture, actual internal upload/Send, canceled upload and standalone Documents upload. File/DataTransfer events populated real file inputs. No second server or Redis routing overrides were used. Fresh public email and image re-upload were not repeated; the earlier 0435 exclusive-stream SMTP/image evidence is **prior evidence** only. No mixed-stream email attribution is claimed. Live Temporal, Citus and paid providers remain unverified.

Cleanup verifies zero owned ticket/contact/comment/thread/lifecycle/document/association/storage/audit records and four removed physical files; no customer mailbox, delivery row or email log was created. Browser restored to original synthetic MSP identity/ticket list. PID/cwd/environment hash and archived unrelated lockfile/migration CLI patches are byte-identical; health returns 200.

CI on `6708e66f` remains separate from focused results: EventBus private-constructor TS2673, three attachment tables missing from tenant deletion order, translation keys, CE Temporal module/type resolution, EE build exit 130, and broader unit failures. Affected-unit logs were unavailable while the workflow was still running at the snapshot. No unrelated CI repairs were attempted; see `ci-before.json` and `ci-*.log`.

Final production verification: the corrected Enterprise webpack build exited **0**, including all **74 static pages** (`production-build-final.log`, `build-exit.json`). Source hashes match the tested files. It used isolated `NEXT_DIST_DIR=.next-documents-lifecycle-build` linked under `/home/robert`, with a build-only dependency link after Next cleanup. The first attempt compiled but failed page collection because external output could not resolve the Next runtime; it is retained separately as a failed attempt. Final warnings include existing scheduling/workflow imports, webpack cache serialization and dynamic rendering. Next skips type validation; the separately passing server typecheck supplies that check. All isolated output/dependency links and generated output have been removed. Synthetic-ticket IndexedDB timer rows were also removed (two intervals and one tracking lock); other browser data was preserved.
