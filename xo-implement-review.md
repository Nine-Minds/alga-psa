# Asked

For alga-2026-0002563, derive quote PDF filenames from the quote title across email and downloads. Review the approved draft and run focused checks before handing it back to XO.

# Done

Reviewed the draft at `46c0b011b9cfa947ca8137a04ef9c5f62ca24f6a` against `636c648b53`. No further source changes were needed.

- `packages/core/src/lib/fileNames.ts:17` sanitizes the title, preserves Unicode, limits length, handles reserved names, and appends `.pdf`. `packages/billing/src/lib/quoteFileNames.ts:7` supplies `Quote_<number>` (or quote ID) only when the title is unusable.
- `packages/billing/src/actions/quoteActions.ts:605` names email attachments from the title; `:2187` returns the same filename for MSP downloads. Consumers use it in `packages/billing/src/components/billing-dashboard/quotes/QuoteDetail.tsx:698`, `QuoteForm.tsx:913`, and `QuotesTab.tsx:402`.
- `packages/billing/src/services/pdfGenerationService.ts:376` reads the tenant-scoped quote title and stores the title-derived document name. `packages/client-portal/src/actions/client-portal-actions/client-billing.ts:1225` checks stored names and regenerates a PDF when the current title produces a different name. `packages/client-portal/src/components/billing/QuoteDetailPage.tsx:307` uses the returned filename.
- `packages/documents/src/actions/documentActions.ts:1534` delegates the response to `packages/documents/src/lib/documentDownloadResponse.ts:13`, which encodes the Unicode filename in `Content-Disposition`.
- Reviewed the existing sign-in repairs: `server/src/lib/initializeApp.ts:776` wires development credential initialization; `server/src/lib/developmentCredentials.ts:47` recognizes unset/seed credentials and preserves other credentials by default; `packages/db/src/models/user.ts:336` conditionally persists by tenant, user, and observed hash before credentials are announced. Authentication verifies the password at `packages/auth/src/actions/auth.tsx:119`.

Repository searches found no remaining unconditional hardcoded quote PDF filename in the production paths inspected.

# Verified

Fresh checks on 2026-09-26: **105 tests passed across 12 files**.

Commands from the worktree root:

```sh
npm run test -w @alga-psa/core -- --run src/lib/fileNames.test.ts
npm run test -w @alga-psa/billing -- --run tests/quote/quoteFileNames.test.ts tests/quote/quoteActions.test.ts tests/quote/quotePdfGenerationService.test.ts
npm run test -w @alga-psa/client-portal -- --run src/actions/client-portal-actions/client-billing.quote.test.ts
npm run test -w @alga-psa/documents -- --run tests/quotePdfDownloadResponse.test.ts
npm run test -w @alga-psa/ui -- --run src/lib/i18n/client.initialization.test.tsx src/lib/i18n/client.pending-initialization.test.tsx src/lib/i18n/namespaceReadiness.test.tsx
npm run test -w @alga-psa/auth -- --run src/components/MspSignIn.i18nBootstrap.test.ts
npm run test -w @alga-psa/db -- src/models/user.updatePasswordIfCurrent.test.ts
```

From `server/`: `../node_modules/.bin/vitest run src/test/unit/developmentCredentials.test.ts --coverage.enabled=false` passed (8 tests, including authentication with the generated credential).

`NODE_OPTIONS=--max-old-space-size=8192 npm run typecheck -w @alga-psa/<package>` passed for `billing`, `client-portal`, and `documents`. `npm run build -w @alga-psa/core` and `git diff --check 636c648b53` passed.

# Unsure

Live sign-in recovery, browser filenames, delivered email attachments, and stored-PDF download headers remain unverified in this assignment. Tests exercise mocked persistence and response construction; they do not establish behavior against the running database/storage. The prior smoke failure therefore remains for the next Smoke Test to resolve. No full smoke or service restart was performed.

# Recommendation

**Advance** to Smoke Test under XO control. The implementation and focused checks pass; live acceptance is still pending.
