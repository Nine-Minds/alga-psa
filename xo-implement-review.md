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
