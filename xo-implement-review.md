# Asked

For alga-2026-0002563, verify title-derived PDF filenames across email and downloads after smoke-fix round 3, rerun focused checks, and report implementation readiness to XO.

# Done

Reviewed HEAD `856bf6610f` against `636c648b53`. **The filename implementation is genuinely present and wired through the production paths.** The latest draft left it unchanged; no further source changes were needed. This finalization updates only the review packet.

- `packages/core/src/lib/fileNames.ts:17` sanitizes the title, preserves Unicode, limits length, handles reserved names, and appends `.pdf`. `packages/billing/src/lib/quoteFileNames.ts:7` supplies `Quote_<number>` (or quote ID) only when the title is unusable.
- `packages/billing/src/actions/quoteActions.ts:605` names email attachments from the title. Send, resend, and reminder paths call this helper at `:1607`, `:1707`, and `:1803`. The download action returns the same filename at `:2187`; consumers use it in `packages/billing/src/components/billing-dashboard/quotes/QuoteDetail.tsx:698`, `QuoteForm.tsx:913`, and `QuotesTab.tsx:402`.
- `packages/billing/src/services/pdfGenerationService.ts:376` reads the tenant-scoped quote title and stores the title-derived document name. `packages/client-portal/src/actions/client-portal-actions/client-billing.ts:1225` checks stored names and regenerates a PDF when the current title produces a different name. `packages/client-portal/src/components/billing/QuoteDetailPage.tsx:307` uses the returned filename.
- `packages/billing/src/services/pdfGenerationService.ts:517` persists `target.documentName`. `packages/documents/src/actions/documentActions.ts:1534` builds the download response from that document metadata through `packages/documents/src/lib/documentDownloadResponse.ts:18`, including the Unicode filename in `Content-Disposition`.

Production-source searches across `packages`, `server/src`, and `ee/server/src` found only three remaining `Quote_` literals: the explicit fallback arguments in the billing helper, PDF service, and portal action cited above. A title of `Estimate` produces `Estimate.pdf`; an unusable title falls back to `Quote_<number>.pdf` or the quote ID. No matching plan was found under `docs/plans` or `ee/docs/plans`; this review verifies the existing implementation directly.

# Verified

Fresh round-3 checks on 2026-09-26 at 15:50 EDT: **88 tests passed across 6 files** (core 9, billing 56, portal 16, documents 7). Coverage includes title-based email attachments, fallback names, stored PDF naming, portal regeneration after rename, Unicode, and parsed response headers.

Commands from the worktree root:

```sh
npm run test -w @alga-psa/core -- --run src/lib/fileNames.test.ts
npm run test -w @alga-psa/billing -- --run tests/quote/quoteFileNames.test.ts tests/quote/quoteActions.test.ts tests/quote/quotePdfGenerationService.test.ts
npm run test -w @alga-psa/client-portal -- --run src/actions/client-portal-actions/client-billing.quote.test.ts
npm run test -w @alga-psa/documents -- --run tests/quotePdfDownloadResponse.test.ts
```

`NODE_OPTIONS=--max-old-space-size=8192 npm run typecheck -w @alga-psa/<package>` passed for `billing`, `client-portal`, and `documents`. `npm run build -w @alga-psa/core` and `git diff --check 636c648b53` passed.

# Unsure

Live sign-in recovery, browser filenames, delivered email attachments, and stored-PDF download headers remain unverified in this assignment. Tests exercise mocked persistence and response construction; they do not establish behavior against the running database/storage. XO reports that the smoke failures concern the development server/environment; these checks establish no filename regression and do not independently diagnose that environment. No full smoke or service restart was performed.

# Recommendation

**Advance** under XO control. The filename implementation and focused checks pass; live acceptance remains pending. This recommendation does not mark smoke passed or advance the board.
---

# Implement review — Service Catalog Management Search (card 6f2723b5)

## Asked
Review the draft at `cae2b733d1` against `docs/plans/2026-09-27-service-catalog-management-search-plan.md`. Check server-side search on the Service Catalog manager, the Service Type / Billing Method filters, pagination and loading behavior, i18n across all locales, and that existing catalog behavior still works. If there is a real defect, fix it minimally, then test, commit and push.

## Done
- Read the full diff `ada739fac8..HEAD` (ServiceCatalogManager.tsx, the 10 locale files, the two new tests, and the LEVERAGE marker in ProductsManager).
- **Defect fixed:** `ServiceCatalogManager.search.contract.test.tsx` was not in `packages/billing/vitest.config.ts` `include`. That list is explicit, so the package's own `npm test` target (the `nx affected -t test` lane) never ran the new suite. Its siblings (`bulkActions` and `rollout`) are listed there for exactly this reason. I added it next to them.

What the component review confirmed against the plan:
- `fetchServices` is now a single `getServices(page, pageSize, { item_kind, search, custom_service_type_id, billing_method, sort, order })` call. The fetch-1000 path and both client-side predicates are gone.
- A `latestRequestRef` sequence guard drops stale responses on the success, error and `finally` paths.
- An `isInitialMountRef` guard replaces the `services.length > 0` guard, so an empty result no longer blocks later refetches. A filter or search change resets to page 1, clears the selection, and fetches page 1.
- The full-page loader shows only before the first load. Refetches keep the table mounted and show a spinner in the SearchInput.
- The empty state appears only when a filter is active and `totalCount === 0`. "Clear filters" resets all four state values, which triggers one batched refetch.
- The debounced `onChange` reads `event.target.value` at fire time. So a clear (✕ or Clear filters) inside the 300 ms window can't bring back the old term.
- The usage-count effect is simplified to the visible page, which is correct now that `services` is always exactly that page.

## Verified
- `packages/billing`: `npx vitest run src/components/settings/billing/ServiceCatalogManager` → 3 files, 17/17 passed (search 6, bulkActions 8, rollout 3). Before the config fix, only 2 files and 11 tests ran.
- `packages/billing`: `tsc --noEmit` → exit 0.
- eslint on ServiceCatalogManager.tsx and the search test: 0 errors. The warnings are non-null assertions elsewhere in the file.
- `node scripts/validate-translations.cjs` → 9 locales, 0 errors, 0 warnings. The keys `filters.searchPlaceholder`, `emptySearch` and `clearFilters` are present in en/de/es/fr/it/nl/pl/pt and the xx/yy pseudo-locales.
- `server`: `vitest run src/test/integration/billing/serviceCatalogSearch.integration.test.ts` against alga-psa-local-test → 1/1 passed. It checks that search excludes products and other tenants' rows and that `totalCount` is the filtered count.

## Unsure
- I did not click through in a browser (plan §6 manual smoke). Everything above comes from the contract and integration tests.
- The empty state can also appear when a fetch *errors* while a filter is active (the error path sets `totalCount = 0`). The error banner still renders above it, so this is cosmetic.
- Changing a Select filter shows progress only as the spinner inside the SearchInput. This is acceptable and matches the plan.
- The `%` and `_` ILIKE wildcard escaping is a pre-existing server behavior that the plan marks as out of scope.
- The uncommitted `package-lock.json` change in the worktree was there before this review. I left it out of the commit.

## Recommendation
**advance.** The implementation matches the plan and the acceptance criteria. The one defect found (the new contract suite was never run by the package's own test lane) is fixed and pushed.
