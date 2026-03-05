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

## Progress Log

- (2026-03-05) Completed `F001` by adding shared remember-email constants in `packages/auth/src/lib/mspRememberedEmail.ts`, reading the durable cookie server-side in `server/src/app/auth/msp/signin/page.tsx`, and plumbing `initialEmail` through `MspSignIn` to the shared login form.
- (2026-03-05) Completed `T001` with a page-level unit test that proves the remembered-email cookie is read on the server and passed into the shared MSP sign-in component.

## Commands / Runbooks

- (2026-03-05) Explore auth + SSO code: `rg -n "auth/msp/signin|MspLoginForm|SsoProviderButtons|msp/sso" server/src ee/server/src packages/auth/src`
- (2026-03-05) Scaffold plan folder: `python3 /Users/roberisaacs/.codex/skills/alga-plan/scripts/scaffold_plan.py 'Remember Previous MSP Login Username' --slug remember-previous-msp-login-username`
- (2026-03-05) Install dependencies in a fresh worktree: `npm install --ignore-scripts`
- (2026-03-05) Run targeted page test without coverage: `cd server && ../node_modules/.bin/vitest run --config vitest.config.ts --coverage.enabled=false src/test/unit/app/auth/msp/signin/page.test.ts`

## Links / References

- Design doc: `docs/plans/2026-03-05-remember-previous-msp-login-username-design.md`
- MSP sign-in page: `server/src/app/auth/msp/signin/page.tsx`
- Shared MSP sign-in shell: `packages/auth/src/components/MspSignIn.tsx`
- Shared MSP login form: `packages/auth/src/components/MspLoginForm.tsx`
- MSP SSO buttons: `packages/auth/src/components/SsoProviderButtons.tsx`
- MSP SSO discover route: `server/src/app/api/auth/msp/sso/discover/route.ts`
- MSP SSO resolve route: `server/src/app/api/auth/msp/sso/resolve/route.ts`
- NextAuth options: `packages/auth/src/lib/nextAuthOptions.ts`

## Open Questions

- Whether the durable remembered-email cookie should be path-scoped narrowly to sign-in routes or broadly enough to simplify callback finalization.
- Whether credential-side remember-email persistence should use a dedicated API route or be folded into an existing auth response surface.
