# Scratchpad — Remember Previous MSP Login Username

- Plan slug: `remember-previous-msp-login-username`
- Created: `2026-03-05`

## What This Is

Keep a lightweight, continuously-updated log of discoveries and decisions made while implementing this plan.

Prefer short bullets. Append new entries as you learn things, and also update earlier notes when a decision changes or an open question is resolved.

## Decisions

- (2026-03-05) Scope is MSP sign-in only for the initial implementation. Client portal behavior is intentionally unchanged.
- (2026-03-05) Persist the email only after successful authentication, not on field entry or blur.
- (2026-03-05) Default behavior is to remember the email. The user opts out with `Public workstation - do not remember my email`.
- (2026-03-05) A successful public-workstation sign-in must clear any previously remembered email on that machine.
- (2026-03-05) Durable remembered-email lifetime is 180 days.
- (2026-03-05) Recommended implementation shape is a server-owned durable cookie plus a short-lived pending cookie for the SSO redirect round-trip.
- (2026-03-05) Credentials-side remember persistence uses a dedicated MSP API route after successful `signIn('credentials', { redirect: false })` resolution, matching the plan artifacts and keeping cookie writes server-owned.

## Discoveries / Constraints

- (2026-03-05) MSP sign-in is rendered by `server/src/app/auth/msp/signin/page.tsx`, which currently returns the shared `MspSignIn` client component from `packages/auth/src/components/MspSignIn.tsx`.
- (2026-03-05) The shared MSP form in `packages/auth/src/components/MspLoginForm.tsx` currently manages email/password entirely client-side and uses `signIn('credentials', { redirect: false })` for credential auth.
- (2026-03-05) Domain-based MSP SSO discovery currently runs in `packages/auth/src/components/SsoProviderButtons.tsx` and depends on the email field value.
- (2026-03-05) The auth package already remembers the last SSO provider in browser `localStorage` under `msp_sso_last_provider`; the username feature should remain separate.
- (2026-03-05) The auth stack already uses `next/headers` cookies within `packages/auth/src/lib/nextAuthOptions.ts`, so callback-time cookie finalization is compatible with current architecture.
- (2026-03-05) No existing MSP `remember me` session-lifetime feature was found in the login/auth code paths reviewed.
- (2026-03-05) The existing MSP sign-in page unit test had stale mocks for `@alga-psa/auth/client` and `@alga-psa/db/models/UserSession`; those needed correction before remember-email coverage could be trusted.
- (2026-03-05) The current worktree has `vitest@4.0.18` with `@vitest/coverage-v8@3.2.4`, so targeted checks need `--coverage.enabled=false` until repo dependency versions are aligned.
- (2026-03-05) `server/vitest.config.ts` was missing the alias for `@alga-psa/product-extension-actions`, which blocks component tests that touch shared UI navigation imports.
- (2026-03-05) The SSO Playwright coverage needed a local fake Google OAuth path because the MSP flow finalizes remember-email state only after a successful callback; the test harness now uses server-side fake OAuth routes gated behind `PLAYWRIGHT_FAKE_GOOGLE_OAUTH`.
- (2026-03-05) Revisit assertions are more reliable in a fresh browser context seeded only with the durable remember-email cookie; reusing the authenticated page leaks session state and can hide prefill regressions.

## Progress Log

- (2026-03-05) Completed `F001` by adding shared remember-email constants in `packages/auth/src/lib/mspRememberedEmail.ts`, reading the durable cookie server-side in `server/src/app/auth/msp/signin/page.tsx`, and plumbing `initialEmail` through `MspSignIn` to the shared login form.
- (2026-03-05) Completed `T001` with a page-level unit test that proves the remembered-email cookie is read on the server and passed into the shared MSP sign-in component.
- (2026-03-05) Completed `F002` by seeding `MspLoginForm` email state from `initialEmail` and syncing that state when the server-provided prefill changes.
- (2026-03-05) Completed `F003`/`F004` by rendering a `Public workstation - do not remember my email` checkbox in `MspLoginForm` and backing it with local state that defaults to `false` on each fresh render.
- (2026-03-05) Completed `F005`-`F011` by adding `POST /api/auth/msp/remember-email`, persisting only after successful credentials sign-in, normalizing before write, clearing on public-workstation success, and using a distinct `HttpOnly` cookie with a 180-day lifetime.
- (2026-03-05) Completed `T002`-`T010` with focused page, form, and API tests that cover absent-cookie prefill, form initialization, checkbox rendering/defaults, credentials-side cookie writes/clears, normalization, max-age, and failure-path non-persistence.
- (2026-03-05) Completed `F012`-`F018` by threading remember-context through MSP SSO resolve, signing a short-lived pending remember cookie, finalizing or clearing the durable cookie only on successful OAuth sign-in, and preserving automatic discovery for prefilled emails.
- (2026-03-05) Completed `T011`-`T019` and `T021` with contract, resolver, button, and callback tests covering cookie isolation, server-side prefill, SSO remember-context request/response handling, OAuth callback finalization, and fail-closed behavior.
- (2026-03-05) Completed `F019`/`F020` and `T020`/`T022`/`T023` by verifying durable-cookie replacement on later successful sign-in, proving OAuth start alone does not create the durable cookie, and confirming client-portal auth code remains unchanged.
- (2026-03-05) Completed `T024` with an EE Playwright credentials-flow test that signs in with a seeded MSP admin, verifies the durable remembered-email cookie, and confirms a later `/auth/msp/signin` visit prefills the email in a clean browser context.
- (2026-03-05) Completed `T025` with an EE Playwright credentials-flow test that starts from a seeded remembered-email cookie, signs in with `Public workstation - do not remember my email` checked, and verifies later sign-in visits show an empty email field.
- (2026-03-05) Completed `T026` with an EE Playwright failure-path test that preserves an existing remembered-email cookie across a rejected MSP credentials sign-in and confirms the old email still prefills on the next visit.
- (2026-03-05) Completed `T027` with an EE Playwright SSO-flow test that resolves Google from the prefilled domain, completes the fake OAuth callback, verifies the durable cookie, and confirms later MSP sign-in visits prefill the SSO email.
- (2026-03-05) Completed `T028` with an EE Playwright SSO-flow test that starts from a seeded remembered-email cookie, opts into `Public workstation`, and verifies a successful SSO callback clears the durable cookie before the next sign-in visit.

## Commands / Runbooks

- (2026-03-05) Explore auth + SSO code: `rg -n "auth/msp/signin|MspLoginForm|SsoProviderButtons|msp/sso" server/src ee/server/src packages/auth/src`
- (2026-03-05) Scaffold plan folder: `python3 /Users/roberisaacs/.codex/skills/alga-plan/scripts/scaffold_plan.py 'Remember Previous MSP Login Username' --slug remember-previous-msp-login-username`
- (2026-03-05) Install dependencies in a fresh worktree: `npm install --ignore-scripts`
- (2026-03-05) Run targeted page test without coverage: `cd server && ../node_modules/.bin/vitest run --config vitest.config.ts --coverage.enabled=false src/test/unit/app/auth/msp/signin/page.test.ts`
- (2026-03-05) Run SSO Playwright subset: `./node_modules/.bin/playwright test --config ee/server/playwright.config.ts ee/server/src/__tests__/integration/msp-remembered-email.playwright.test.ts --grep "T027|T028"`
- (2026-03-05) Run credentials + cancelled-SSO Playwright subset: `./node_modules/.bin/playwright test --config ee/server/playwright.config.ts ee/server/src/__tests__/integration/msp-remembered-email.playwright.test.ts --grep "T024|T025|T026|T029"`

## Links / References

- Design doc: `docs/plans/2026-03-05-remember-previous-msp-login-username-design.md`
- MSP sign-in page: `server/src/app/auth/msp/signin/page.tsx`
- Shared MSP sign-in shell: `packages/auth/src/components/MspSignIn.tsx`
- Shared MSP login form: `packages/auth/src/components/MspLoginForm.tsx`
- Remember-email helper: `packages/auth/src/lib/mspRememberedEmail.ts`
- Credentials remember route: `server/src/app/api/auth/msp/remember-email/route.ts`
- MSP SSO buttons: `packages/auth/src/components/SsoProviderButtons.tsx`
- MSP SSO discover route: `server/src/app/api/auth/msp/sso/discover/route.ts`
- MSP SSO resolve route: `server/src/app/api/auth/msp/sso/resolve/route.ts`
- NextAuth options: `packages/auth/src/lib/nextAuthOptions.ts`

## Open Questions

- Whether the durable remembered-email cookie should be path-scoped narrowly to sign-in routes or broadly enough to simplify callback finalization.
- Whether credential-side remember-email persistence should use a dedicated API route or be folded into an existing auth response surface.
