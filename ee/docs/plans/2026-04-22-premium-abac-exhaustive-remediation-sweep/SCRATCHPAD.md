# Scratchpad — Premium ABAC Exhaustive Remediation Sweep

- Plan slug: `premium-abac-exhaustive-remediation-sweep`
- Created: `2026-04-22`

## What This Is

This is the working memory for the exhaustive post-remediation premium-ABAC sweep.

It intentionally preserves the earlier 2026-04-22 remediation plan as a historical checkpoint and expands the remaining work into one comprehensive backlog covering lifecycle integrity, server-action parity, count/pagination honesty, linked-subresource semantics, and final close-out validation.

## Decisions

- (2026-04-22) Create a **new** remediation plan instead of mutating `2026-04-22-premium-abac-remediation/`, so the earlier plan remains the historical record of the surgical pass.
- (2026-04-22) This plan is the “leave no stone unturned” sweep for the premium-ABAC rollout.
- (2026-04-22) API controller hardening is no longer enough; server actions, helper layers, counts, summaries, and linked-resource surfaces are now first-class remediation targets.
- (2026-04-22) Aggregates, totals, tree counts, summary metrics, and file/URL helpers are security surfaces and must be treated as such.
- (2026-04-22) Default principle for this sweep: reuse the shared kernel or a parent-authorized structural helper; do not create new shadow auth models.
- (2026-04-22) Archive semantics decision: archiving a bundle will immediately disable active assignments to avoid misleading active-but-inert state.
- (2026-04-22) Clone semantics decision: cloning a bundle without a published revision is rejected; cloning only uses published revisions.

## Discoveries / Constraints

### Historical context
- (2026-04-22) Existing premium-ABAC plan: `ee/docs/plans/2026-04-21-premium-abac-authorization-kernel/`
- (2026-04-22) Existing surgical remediation plan: `ee/docs/plans/2026-04-22-premium-abac-remediation/`
- (2026-04-22) Latest remediation checkpoint commit before this new plan: `cfa8cd208` — `fix(remediation): harden api parity and bundle lifecycle`

### Bundle lifecycle / EE control plane
- (2026-04-22) `ensureDraftBundleRevision(...)` still has a revision-number race window: concurrent callers can compute the same `nextRevisionNumber`.
- (2026-04-22) `ensureDraftBundleRevision(...)` copies published rules outside a single transaction boundary, so draft creation can succeed while rule copy fails partway.
- (2026-04-22) EE actions call `ensureDraftBundleRevision(...)` before later write operations, leaving a stale-draft race window between draft acquisition and rule mutation/publish.
- (2026-04-22) `publishBundleRevision(...)` currently needs a stronger policy around empty/invalid draft publish behavior.
- (2026-04-22) `20260422143000_enforce_authorization_revision_lifecycle_uniqueness.cjs` needs a duplicate-row preflight, otherwise uniqueness-index creation can fail too quietly when historical duplicates already exist.
- (2026-04-22) Assignment/archive semantics are still under-defined: archived bundles can leave confusing assignment state behind unless governance is tightened further.
- (2026-04-22) Implemented: `ensureDraftBundleRevision(...)` is now wrapped in one transaction that locks the bundle row, serializes draft creation, and copies published rules atomically.
- (2026-04-22) Implemented: draft mutation/publish EE actions now run `ensureDraft + write` in one transaction boundary for stale-state safety.
- (2026-04-22) Implemented: `publishBundleRevision(...)` now rejects empty drafts with an actionable error.
- (2026-04-22) Implemented: assignment creation now rejects archived bundles; assignment status updates now fail loudly for missing assignments and archived-bundle reactivation attempts.
- (2026-04-22) Implemented: `archiveBundle(...)` now disables active assignments as part of archive transition.
- (2026-04-22) Implemented: lifecycle-uniqueness migration now preflights duplicate draft/published rows and emits a concrete repair query/path.

### Billing / quote server actions
- (2026-04-22) `packages/billing/src/actions/quoteActions.ts` is still inconsistent: `getQuote`, `listQuotes`, and `approveQuote` use kernel logic, but many other reads/mutations remain RBAC-only.
- (2026-04-22) `listQuotes` still reports `total: filteredData.length`, which is page-local post-filter count, not true authorized total.
- (2026-04-22) Quote item helpers (`add/update/remove/reorder`) still need parent-quote authorization and item-to-quote integrity validation.
- (2026-04-22) Converted-contract / converted-invoice lookup helpers can return quotes without reapplying quote narrowing.
- (2026-04-22) PDF/preview/reminder/send/conversion/version flows need the same read-before-mutate parity now present in `ApiQuoteController.ts`.
- (2026-04-22) Implemented shared quote-read authorization helper set in `packages/billing/src/actions/quoteActions.ts`:
  - `createQuoteAuthorizationKernel(...)`
  - `authorizeQuoteReadDecision(...)`
  - `getAuthorizedQuoteForRead(...)`
  - `assertQuoteReadAllowedForMutation(...)`
- (2026-04-22) Implemented record-level quote auth for read helpers:
  - versions, conversion preview, converted-contract/invoice lookups, pdf file-id lookup, PDF download, preview render.
- (2026-04-22) Implemented record-level quote auth for mutations:
  - update/delete, submit-for-approval, request-changes, send/resend/remind, create-revision, conversion flows, regenerate-pdf.
- (2026-04-22) Implemented quote-item integrity guards:
  - item update cannot move across quotes.
  - add/update/remove/reorder now require parent quote authorization.
- (2026-04-22) Implemented authorization-aware quote pagination totals by using `buildAuthorizationAwarePage(...)` and authorized `total/totalPages` semantics.

### Documents
- (2026-04-22) `packages/documents/src/actions/documentActions.ts` now has partial auth-aware pagination, but many other surfaces remain RBAC-only or unauthenticated.
- (2026-04-22) URL helper surfaces such as download/preview/thumbnail/image helper paths still need a complete kernel-backed story.
- (2026-04-22) Bulk mutations (move, visibility, association, folder ops) still need record-level authorization.
- (2026-04-22) `getDocumentCountsForEntities` and `getFolderStats` were flagged as especially risky because they can leak counts/sizes without real narrowing.
- (2026-04-22) `documentPermissionUtils.ts` still acts as a weaker parallel permission model and should likely be bypassed or retired in favor of kernel-backed helpers.
- (2026-04-22) `documentContentActions.ts` and `documentBlockContentActions.ts` were flagged for very weak or missing auth.
- (2026-04-22) Implemented kernel-backed document URL helper hardening (`F016`) by adding/using authorized document resolvers:
  - new helper: `getAuthorizedDocumentById(...)` in `packages/documents/src/actions/documentActions.ts`
  - existing helper reused: `getAuthorizedDocumentByFileId(...)`
- (2026-04-22) Hardened server URL routes to use authorized resolvers instead of raw RBAC-only document lookups:
  - `server/src/app/api/documents/[documentId]/download/route.ts`
  - `server/src/app/api/documents/[documentId]/preview/route.ts`
  - `server/src/app/api/documents/[documentId]/thumbnail/route.ts`
  - `server/src/app/api/documents/view/[fileId]/route.ts`
- (2026-04-22) Hardened URL-returning document actions to require authorized-document lookup before returning URL values:
  - `getDocumentDownloadUrl`
  - `getDocumentThumbnailUrl`
  - `getDocumentPreviewUrl`
  - `getImageUrl`
- (2026-04-22) Implemented document mutation hardening (`F017`) with shared mutation guards:
  - new helper: `assertAuthorizedDocumentSetForMutation(...)` in `packages/documents/src/actions/documentActions.ts`
  - update/delete/association/folder-mutation flows now fail closed when any targeted document is missing or unauthorized.
- (2026-04-22) Hardened content/block-content document helpers (`F018`) so read/write/delete operations require:
  - resource-level RBAC permission (`document.read/update/delete`)
  - authorized parent-document resolution via `getAuthorizedDocumentById(...)`
- (2026-04-22) Implemented aggregate hardening (`F019`) for document count surfaces:
  - `getDocumentCountsForEntities` now resolves associated documents and counts only kernel-authorized records.
  - `getFolderStats` now computes count/size from authorized document sets.
  - folder-tree count enrichment now removes hardcoded entity-type shortcuts and counts only authorized records.
- (2026-04-22) Implemented `F020` by removing the remaining `documentPermissionUtils`-based entity-type prefilter from `getDocumentsByFolder(...)`; folder document visibility now depends on kernel-backed document authorization, not helper-layer shadow auth rules.
- (2026-04-22) Closed `F021` via the same aggregate sweep: folder trees (`enrichFolderTreeWithCounts`), folder stats (`getFolderStats`), and entity count helpers now derive values from authorized-document sets only.
- (2026-04-22) Typecheck status after `F018`:
  - `packages/documents` still has pre-existing TS errors in UI components (`block_data` typing in `CollaborativeEditor.tsx` and `Documents.tsx` family).
  - no new type errors remain in changed action files after remediation patching.

### Assets
- (2026-04-22) `packages/assets/src/actions/assetActions.ts` only applies asset-level narrowing in a few places (`getAsset`, `getAssetDetailBundle`, `listAssets`).
- (2026-04-22) `listAssets` still returns pre-narrowing totals.
- (2026-04-22) `getAssetSummaryMetrics` was flagged as a zero-auth surface.
- (2026-04-22) Relationship, maintenance, history, linked-ticket, and client-summary paths still mostly rely on RBAC only.
- (2026-04-22) Asset detail bundles need an explicit policy decision about linked tickets/documents: parent asset read only, or parent + child intersection.

### Projects / tasks / statuses
- (2026-04-22) `packages/projects/src/actions/projectActions.ts` is partially hardened but still has remaining parity work.
- (2026-04-22) Local exploratory edits are currently in progress in `projectActions.ts` and `projectAuthorization.contract.test.ts`; they are not yet committed and are not by themselves the exhaustive solution.
- (2026-04-22) `packages/projects/src/actions/projectTaskActions.ts` remains broadly RBAC-only and does not consistently resolve/authorize the parent project.
- (2026-04-22) `packages/projects/src/actions/projectTaskStatusActions.ts` was flagged for both RBAC-only paths and zero-check surfaces.
- (2026-04-22) Cross-project move/duplicate/link flows are especially risky because they need authorization on both source and target projects.
- (2026-04-22) Phase task counts and status-mapping task counts are auth-sensitive aggregate leaks, not just UX helpers.

### Time / remaining resource-family re-audit
- (2026-04-22) The prior remediation fixed the `time_entry` resource key mismatch, but a broader re-audit is still needed to confirm there are no leftover helper/count leaks or RBAC-only delegation paths.

## Commands / Runbooks

- (2026-04-22) Review current auth-remediation history:
  - `git log --oneline --decorate --reverse --ancestry-path $(git merge-base HEAD origin/main)..HEAD`
- (2026-04-22) Review the latest remediation checkpoint commit:
  - `git show --stat cfa8cd208`
- (2026-04-22) Inspect bundle lifecycle service:
  - `read server/src/lib/authorization/bundles/service.ts`
- (2026-04-22) Inspect EE bundle actions:
  - `read ee/server/src/lib/actions/auth/authorizationBundleActions.ts`
- (2026-04-22) Inspect hardened API controller patterns for reuse:
  - `read server/src/lib/api/controllers/ApiTicketController.ts`
  - `read server/src/lib/api/controllers/ApiProjectController.ts`
  - `read server/src/lib/api/controllers/ApiQuoteController.ts`
  - `read server/src/lib/api/controllers/authorizationAwarePagination.ts`
- (2026-04-22) Inspect server-action domains:
  - `read packages/billing/src/actions/quoteActions.ts`
  - `read packages/documents/src/actions/documentActions.ts`
  - `read packages/assets/src/actions/assetActions.ts`
  - `read packages/projects/src/actions/projectActions.ts`
  - `read packages/projects/src/actions/projectTaskActions.ts`
  - `read packages/projects/src/actions/projectTaskStatusActions.ts`
- (2026-04-22) Quick grep for auth-sensitive list/count/helper surfaces:
  - `rg -n "count\(|totalCount|pagination|hasPermission\(|authorizeResource\(|authorizeMutation\(" packages server ee`
- (2026-04-22) Run targeted bundle hardening unit/contract tests:
  - `cd server && pnpm vitest src/test/unit/authorization/bundleLifecycleHardening.contract.test.ts src/test/unit/authorization/bundleManagement.contract.test.ts src/test/unit/migrations/authorizationBundleRevisionLifecycleUniquenessMigration.test.ts`
- (2026-04-22) Run lifecycle integration tests (requires local Postgres):
  - `cd server && pnpm vitest src/test/integration/authorization/bundleLifecycleIntegrity.integration.test.ts`
- (2026-04-22) Run quote parity contract test:
  - `cd server && pnpm vitest ../packages/billing/src/actions/quoteAuthorizationParity.contract.test.ts`
- (2026-04-22) Run document URL authorization contract test:
  - `cd server && pnpm vitest src/test/unit/documents/documentUrlAuthorization.contract.test.ts`
- (2026-04-22) Run focused document mutation/content regression tests:
  - `cd server && pnpm vitest src/test/unit/documentFolderOperations.test.ts ../packages/documents/tests/documentActions.authorization.contract.test.ts ../packages/documents/tests/documentContent.authorization.contract.test.ts --coverage.enabled false`
- (2026-04-22) Run quote parity contract test for `T007-T010` status validation:
  - `cd server && pnpm vitest ../packages/billing/src/actions/quoteAuthorizationParity.contract.test.ts --coverage.enabled false`
- (2026-04-22) Run package-level document typecheck:
  - `pnpm -C packages/documents typecheck`
- (2026-04-22) Re-run count/folder hardening tests:
  - `cd server && pnpm vitest src/test/unit/documentFolderOperations.test.ts ../packages/documents/tests/documentActions.authorization.contract.test.ts --coverage.enabled false`

## Links / References

- Original premium-ABAC plan:
  - `ee/docs/plans/2026-04-21-premium-abac-authorization-kernel/PRD.md`
  - `ee/docs/plans/2026-04-21-premium-abac-authorization-kernel/features.json`
  - `ee/docs/plans/2026-04-21-premium-abac-authorization-kernel/tests.json`
  - `ee/docs/plans/2026-04-21-premium-abac-authorization-kernel/CURRENT_AUTHORIZATION_BASELINE.md`
- Surgical remediation plan:
  - `ee/docs/plans/2026-04-22-premium-abac-remediation/PRD.md`
  - `ee/docs/plans/2026-04-22-premium-abac-remediation/features.json`
  - `ee/docs/plans/2026-04-22-premium-abac-remediation/tests.json`
  - `ee/docs/plans/2026-04-22-premium-abac-remediation/SCRATCHPAD.md`
- Key implementation files:
  - `server/src/lib/authorization/bundles/service.ts`
  - `server/src/lib/authorization/kernel/providers/bundleProvider.ts`
  - `server/src/lib/api/controllers/authorizationKernel.ts`
  - `server/src/lib/api/controllers/authorizationAwarePagination.ts`
  - `packages/billing/src/actions/quoteActions.ts`
  - `packages/documents/src/actions/documentActions.ts`
  - `packages/assets/src/actions/assetActions.ts`
  - `packages/projects/src/actions/projectActions.ts`
  - `packages/projects/src/actions/projectTaskActions.ts`
  - `packages/projects/src/actions/projectTaskStatusActions.ts`

## Open Questions

- Should linked tickets/documents inside asset detail bundles require parent asset auth only, or intersection with child-resource auth?
- For project-linked ticket/task surfaces, where exactly should inheritance stop so ticket auth is not weakened?
- Should archiving a bundle automatically disable assignments for hygiene, or should assignments remain inert but active in the table?
- If a bundle has never been published, should cloning copy its latest draft or reject the clone as ambiguous in-progress state?
- Is `SCRATCHPAD.md` enough for the exhaustive surface matrix, or should we add a dedicated close-out artifact later?

## Progress Log

- (2026-04-22) Chose plan shape **B** with the user: preserve the earlier remediation plan and create a new exhaustive sweep plan.
- (2026-04-22) Ran parallel reviewer audits across five domains:
  - documents
  - billing quote server actions
  - assets
  - projects/tasks/statuses
  - bundle lifecycle / EE control plane
- (2026-04-22) Reviewer findings confirmed that the remaining scope is materially larger than the earlier surgical remediation plan and warrants a dedicated exhaustive backlog.
- (2026-04-22) Created this new plan folder and drafted a PRD/features/tests set centered on the reviewer findings plus the already-known parity backlog.
- (2026-04-22) Completed `F001` by preserving explicit lineage/cross-links in the new PRD and scratchpad to both prior plans and prior checkpoint commit.
- (2026-04-22) Completed lifecycle feature wave `F002-F010` in:
  - `server/src/lib/authorization/bundles/service.ts`
  - `ee/server/src/lib/actions/auth/authorizationBundleActions.ts`
  - `server/migrations/20260422143000_enforce_authorization_revision_lifecycle_uniqueness.cjs`
- (2026-04-22) Added lifecycle regression coverage for `T001-T006` via:
  - `server/src/test/integration/authorization/bundleLifecycleIntegrity.integration.test.ts`
  - `server/src/test/unit/migrations/authorizationBundleRevisionLifecycleUniquenessMigration.test.ts`
  - `server/src/test/unit/authorization/bundleLifecycleHardening.contract.test.ts`
- (2026-04-22) Validation status:
  - unit/contract tests pass for touched lifecycle contracts/migration.
  - integration suite is authored but currently cannot execute in this shell because Postgres is unavailable (`ECONNREFUSED 127.0.0.1:5432`).
- (2026-04-22) Completed quote hardening feature wave `F011-F015` in:
  - `packages/billing/src/actions/quoteActions.ts`
  - `packages/billing/src/actions/quoteAuthorizationParity.contract.test.ts`
- (2026-04-22) Completed document URL helper hardening `F016` in:
  - `packages/documents/src/actions/documentActions.ts`
  - `server/src/app/api/documents/[documentId]/download/route.ts`
  - `server/src/app/api/documents/[documentId]/preview/route.ts`
  - `server/src/app/api/documents/[documentId]/thumbnail/route.ts`
  - `server/src/app/api/documents/view/[fileId]/route.ts`
  - `server/src/test/unit/documents/documentUrlAuthorization.contract.test.ts`
- (2026-04-22) Completed document mutation hardening `F017` in:
  - `packages/documents/src/actions/documentActions.ts`
  - `server/src/test/unit/documentFolderOperations.test.ts` (updated to validate new mutation-guard behavior)
  - `packages/documents/tests/documentActions.authorization.contract.test.ts` (expanded with `T012` mutation-surface contract coverage)
- (2026-04-22) Completed document content/block-content hardening `F018` in:
  - `packages/documents/src/actions/documentContentActions.ts`
  - `packages/documents/src/actions/documentBlockContentActions.ts`
  - `packages/documents/tests/documentContent.authorization.contract.test.ts` (`T013`)
- (2026-04-22) Completed document aggregate hardening `F019` in:
  - `packages/documents/src/actions/documentActions.ts`
  - `packages/documents/tests/documentActions.authorization.contract.test.ts` (`T014`)
  - `server/src/test/unit/documentFolderOperations.test.ts` (updated folder-stats expectations for auth-aware counting)
- (2026-04-22) Completed `F020` (bypass divergent `documentPermissionUtils` shadow auth path) in:
  - `packages/documents/src/actions/documentActions.ts`
  - `packages/documents/tests/documentActions.authorization.contract.test.ts`
  - `server/src/test/unit/documentFolderOperations.test.ts` (removed entity-type helper mock assumptions)
- (2026-04-22) Completed `F021` (authorized semantics for folder trees/counts/summary metrics) in:
  - `packages/documents/src/actions/documentActions.ts`
  - `packages/documents/tests/documentActions.authorization.contract.test.ts` (`T014`)
  - `server/src/test/unit/documentFolderOperations.test.ts`
- (2026-04-22) Marked quote parity regression tests `T007-T010` complete after re-validating:
  - `packages/billing/src/actions/quoteAuthorizationParity.contract.test.ts`
- (2026-04-22) Marked document URL regression test `T011` complete:
  - `server/src/test/unit/documents/documentUrlAuthorization.contract.test.ts`
