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
- `NODE_OPTIONS=--max-old-space-size=8192 npm -w @alga-psa/billing run typecheck` — passed on Node `v22.18.0`. The default V8 heap limit in this environment was 4144 MiB; the command raised the Node heap allowance to 8192 MiB. Available host memory at the rerun was 45 GiB.
- `npm -w @alga-psa/billing run build` — passed.

A direct run of `src/constants/billingQuoteValidity.test.ts` initially found no tests because the suite was missing from the billing package Vitest include list. The include list was corrected and `npm -w @alga-psa/billing test -- src/constants/billingQuoteValidity.test.ts` passed (2 tests).

The package build and the repository build both passed. The repository build command was `npm run build`; it completed the AssemblyScript build, Nx dependency builds, and the production Next.js build (`Compiled successfully`). Turbopack emitted five broad filesystem-trace warnings in unrelated document-preview and extension-asset code. The app build does not require the board service to be running.

Review follow-up reconfirmed no listener on port 3212 (`curl` returned connection refused). Board-service restoration remains an external prerequisite for isolated authentication and all live behavior checks; the service was not started.

## Mitigation pass 2026-09-26

No task-specific approved plan was present in `docs/plans/` or in the branch's
plan-file history. The user-provided acceptance scope and `evidence/plan.txt`
remain the working checklist.

The board server was still unavailable on port 3212 (`curl` to both
`127.0.0.1:3212/auth/msp/signin` and `localhost:3212/auth/msp/signin` failed
with connection refused). The board service log at
`~/.alga-dev/card-services/card-service_384fd554-43c1-4e15-8ed9-7423eb6de35a_dev-server_1/service.log`
contains an explicit Next warning at line 19129: `/_next/webpack-hmr` from
`127.0.0.1` was blocked as a cross-origin dev resource. `server/next.config.mjs`
already accepted extra development origins through `DEV_ALLOWED_ORIGINS`, but
the loopback IP was not in its default list. The config now includes
`127.0.0.1` by default and retains any comma-separated configured origins. A
focused config test covers both default loopback access and custom entries.
This addresses the observed HMR-origin rejection; it does not establish that
HMR caused the translation-loading screen.

The same saved log shows the sign-in route returning 200, followed by the HMR
warning and unrelated Temporal connection failures; it contains no HMR
`ERR_INVALID_HTTP_RESPONSE` message or HTTP 431 response. The earlier browser
trace (`/tmp/alga-smoke-evidence/alga-2026-0002564-20260926T0005/network-errors.json`)
records four localhost requests returning 431, but no cookie-size metadata or
locale-resource request results. The `I18nProvider` in
`packages/ui/src/lib/i18n/client.tsx` holds children until i18next init and
route-namespace loading settle. Since no live browser was available and the
preserved trace omits locale requests, the loading-screen cause remains open.
Using `127.0.0.1` avoids the shared `localhost` cookies, but live behavior on
that origin was not rechecked.

Current offline checks:

- `npx vitest run tests/billingSettingsActions.defaultCurrency.test.ts src/components/billing-dashboard/quotes/QuoteForm.terms.test.tsx src/constants/billingQuoteValidity.test.ts --reporter=verbose` (from `packages/billing`) — 27 tests passed.
- `npx vitest run src/test/unit/devAllowedOrigins.unit.test.ts --reporter=verbose` (from `server`) — 2 tests passed.
- `npx vitest run src/test/integration/devServerStartup.integration.test.ts --reporter=verbose` (from `server`) — 7 tests passed, including HMR delegation under Webpack and Turbopack.
- `NODE_OPTIONS=--max-old-space-size=8192 npm -w @alga-psa/billing run typecheck` — passed.
- `NODE_OPTIONS=--max-old-space-size=8192 npm run typecheck` (from `server`) — did not complete; TypeScript exhausted the 8 GiB V8 heap after about 2.5 minutes. The default 4 GiB attempt also exhausted memory. The production build completed successfully, but skipped its own type validation; the standalone server typecheck remains unverified.
- `npm run build` — passed, including the production Next.js compile and static page generation. Turbopack reported the same broad filesystem-trace warnings in document preview and extension assets as the prior build.

No billing feature code changed in this pass and no quote-validity defect was
established. The board app was not started, no credentials were recovered or
used, and no database rows were changed. Screenshots and tenant-scoped database
evidence for authentication, settings persistence, quote creation, invalid
input, and existing/manual-date preservation are still outstanding. After
board-service restoration, use the isolated-account steps in `evidence/plan.txt`
and rerun those live checks; do not reset shared accounts.
