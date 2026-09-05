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

## Verification

Fresh focused run: **98 passed, one opt-in PgBoss/SMTP recovery case skipped**, across nine files. The final database suite was rerun after adding standalone authorization coverage: **55 passed, one skipped**. Fixtures use migrated PostgreSQL with transaction rollback; session/RBAC and connection binding are controlled seams. The actual consolidated action, document authorizer, lifecycle queries, counts and pagination execute. Coverage includes public/internal attachments, removed/expired/other-owner drafts, standalone documents, denied document permission and client/tenant access. Existing attachment tests cover portal download/preview denial, board restrictions, bundle/source eligibility and email replay/recovery. Component tests exercise all four save paths and the real section → Documents → storage-card metadata transitions.

Fresh port 3653 smoke used actual application upload and save handlers: internal PDF submission, a second PDF upload followed by cancellation, standalone Documents upload, full ticket reload and same-ID visibility edits in both directions. Three cards remain after reload; the internal file shows Internal with a disabled toggle, and the canceled file is absent. Public content was a database fixture, with no publication event. File inputs received browser `File`/`DataTransfer` events because algadev cannot select native files.

Authenticated portal ticket/global listings exclude internal and canceled files. Both files return download/view 403 and preview 404. Public download/view return 200 and the original 638 bytes. PDF thumbnail generation still fails locally, as it did before this repair. No new image or email delivery acceptance claim is made: existing regression coverage and the prior smoke report remain the evidence for those unchanged paths. No temporary Redis routing or additional app instance was used. Customer delivery rows, email logs and the unique recipient mailbox remain absent after cancellation and edits.

Evidence: `/tmp/alga-smoke-evidence/documents-reload-repair-20260905/`, especially `reload-assertions.json`, `03-full-reload-pass.png`, `metadata-internal.json`, `metadata-public.json`, `portal-access.json`, `final-state.json`, and the test/build logs. The earlier failing reproduction is `/tmp/alga-smoke-evidence/ticket-comment-attachments-20260905T0435/REPORT.md` and screenshots 17–18.

## Final builds and preservation

Affected Nx builds passed for documents/tickets and 24 dependency tasks (`packages-final.log`). These two feature packages use source transpilation/no-op Nx build targets, so the successful server typecheck and production webpack build provide their compilation checks. The final Enterprise production build exited 0, including all 74 static pages (`production-build-final.log`, `build-exit.json`). Next skips type checking during that build; the separate `npm -w server run typecheck -- --tsBuildInfoFile ...` exited 0. Existing scheduling-export, workflow-import, cache-size and dynamic-rendering warnings remain.

The first build attempt inherited the running dev process's `TURBOPACK` setting, conflicting with `--webpack`; the isolated build environment then omitted that setting. A later attempt hit `/tmp` write quota with a 7.2 GB webpack cache despite free space reported by `df`. The final build used `NEXT_DIST_DIR=.next-documents-reload-build` linked to dedicated `/tmp` output, with only its webpack cache moved to `/home/robert/documents-reload-webpack-cache`, where 124 GiB was free. The failed attempts are not acceptance results. Both output/cache directories and their links were removed after success. The running process environment was never changed.

The final full reload also passed (`08-final-reload-pass.png`). Cleanup verified zero remaining synthetic ticket/contact/comment/thread/lifecycle/document/association/storage/audit records and zero physical storage files. The unique customer mailbox never existed; no synthetic mail needed removal. No temporary routing was installed. The card's browser is restored to the original synthetic MSP identity and ticket list. PID 839208, its cwd/environment hash, and the unrelated lockfile/migration CLI patches remain unchanged; port 3653 is healthy. `cleanup.json` and `preservation.json` record the final checks.

Live Graph/Resend, Citus, Temporal, image re-upload and fresh public email delivery were not retested for this read/refresh repair. Existing email regressions were reused; no mixed-stream delivery was attributed to this branch.
