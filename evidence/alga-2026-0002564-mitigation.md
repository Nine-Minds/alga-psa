# alga-2026-0002564 mitigation round

## Result

Smoke verification is blocked by the missing board-managed application service. At inspection time nothing was listening on port 3212 (`curl http://localhost:3212/` failed with connection refused; `ss` showed no listener). The `alga-psa-local-test` PgBouncer, PostgreSQL, and Redis containers were running, and PostgreSQL accepted connections. No application server was started, no account password was changed, and no feature code was modified.

The working tree was clean before this report. Branch: `feature/alga-2026-0002564-configurable-default-quote-val`, three commits ahead of `origin/main` after this report was committed. The feature commits do not include an approved plan. The recovered smoke procedure is now tracked at `evidence/plan.txt`. The previous run's plan and artifacts are under `/tmp/alga-smoke-evidence/alga-2026-0002564-20260926T0005/` and are outside Git.

## Diagnosis boundary

The previous evidence records authenticated requests to `localhost:3212` returning HTTP 431, including the billing settings document, and an alternate `127.0.0.1` sign-in that returned 200 but stayed on the loading screen. Its network log contains request URLs, methods, and statuses only; it does not contain cookie names, counts, or sizes, nor the effective request-header limit. It also does not list translation or other asset requests for the loopback origin. The captured screenshots are visually blank and add no diagnostic detail.

The service is currently absent, so this run could not reproduce the request, inspect current headers/server limits, inspect loopback asset requests or origin handling, or confirm authentication configuration beyond the presence of relevant environment variable names. Browser connection setup failed before a live tab could be inspected. The oversized-header diagnosis and the loopback translation failure therefore remain unconfirmed; no server configuration change was justified by available evidence.

## Account and recovery

No account was reset or otherwise modified. The shared Glinda account had a known password drift in the prior run; repeating a shared-account reset was avoided. Once the board service is restored, recover the dev-login credential directly from the board dev-server terminal history and enter it in a fresh isolated browser profile without copying it into logs, evidence, or Git. Verify the account can open Billing Settings > General and create a quote, and that its permissions include billing settings read/update and quote creation. Do not place credentials in this report.

## Code-grounded behavior inspected

The current implementation defines a 30-day default, accepts whole-number settings from 1 through 365, and validates the update server-side. The Billing Settings quote panel rejects invalid input in the UI and saves through `updateDefaultBillingSettings`. `QuoteForm` computes the default validity date from quote date plus the configured days; existing quote edit state uses the stored validity date. No demonstrated defect was found in this inspection.

## Requested live evidence

All live items remain unverified because the authenticated application was unavailable:

1. An unconfigured tenant displays and uses 30 days.
2. Saving 15 days survives reload and is stored on the correct tenant row.
3. A new quote defaults to quote date plus 15 calendar days and retains the date after save.
4. UI and server reject out-of-range and fractional values.
5. Changing the tenant default leaves existing quote validity dates unchanged.
6. Billing settings and quote screens render in an isolated authenticated session.

The earlier database preflight in `/tmp/alga-smoke-evidence/alga-2026-0002564-20260926T0005/database-preflight.txt` records a 30-day row and the 1–365 database constraint for its then-current tenant. It is historical evidence, not a fresh assertion for this run.

## Checks

Passed:

- `npx vitest run tests/billingSettingsActions.defaultCurrency.test.ts --reporter=verbose` — 18 tests passed, including default insertion, saving the validity field without clobbering other settings, and rejection of 0, -1, 366, 1.5, and NaN.
- `npx vitest run src/components/billing-dashboard/quotes/QuoteForm.terms.test.tsx --reporter=verbose` — 7 tests passed, including 15-day defaulting, invalid-setting fallback, and preserving the stored validity date while editing.
- `npm -w @alga-psa/billing run typecheck` — passed.
- `npm -w @alga-psa/billing run build` — passed.

A direct run of `src/constants/billingQuoteValidity.test.ts` initially found no tests because the suite was missing from the billing package Vitest include list. The include list was corrected and `npm -w @alga-psa/billing test -- src/constants/billingQuoteValidity.test.ts` passed (2 tests).

The package build and the repository build both passed. The repository build command was `npm run build`; it completed the AssemblyScript build, Nx dependency builds, and the production Next.js build (`Compiled successfully`). Turbopack emitted five broad filesystem-trace warnings in unrelated document-preview and extension-asset code. The app build does not require the board service to be running.

## Next action

Board-service restoration on port 3212 is an external prerequisite. Once restored through the normal board workflow, use the isolated-account procedure in `evidence/plan.txt`. Capture cookie names/counts/aggregate sizes only, inspect the relevant request-header limit and loopback asset failures, and rerun the live behavior checks. Do not change product code unless that verification demonstrates a defect.
