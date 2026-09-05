# Client portal root 404 implementation plan

## Problem

A registered vanity portal host resolves `/` to `/client-portal`, and the sign-in/handoff flow is allowed to preserve that path. The protected client portal has a shared layout and a dashboard page at `/client-portal/dashboard`, but no page at the exact `/client-portal` route. After a successful domain-session exchange, an authenticated request to the preserved root therefore reaches a real 404.

The current code confirms the split:

- `server/src/lib/deployment/rootRedirect.ts` returns `/client-portal` for a matching portal-domain row.
- `server/src/app/route.tsx` redirects the request to that result.
- `server/src/app/client-portal/dashboard/page.tsx` is the dashboard implementation.
- `server/src/app/client-portal/page.tsx` does not exist.
- The domain-session route safely accepts relative client-portal return paths and defaults to `/client-portal/dashboard`; changing its session or OTT behavior is unnecessary.

## Design

1. Normalize vanity-host root resolution to the real dashboard route.
   - Change `RootRedirectTarget` and the matching-portal-domain result in `server/src/lib/deployment/rootRedirect.ts` from `/client-portal` to `/client-portal/dashboard`.
   - Preserve the canonical-host result (`/msp/dashboard`), unknown-host fallback, lookup failure behavior, and non-standard-port candidate ordering.

2. Make the exact client-portal root a durable authenticated alias.
   - Add `server/src/app/client-portal/page.tsx` as a server route that redirects to `/client-portal/dashboard` with Next's `redirect()` primitive.
   - This is defense in depth for preserved callbacks, bookmarks, and direct authenticated requests. It reuses the existing client-portal layout/auth boundary and dashboard implementation rather than duplicating UI or data loading.

3. Leave the established auth/session handoff contract alone.
   - Do not change domain-session OTT creation, cookie issuance, vanity-host preservation, general relative return-path support, or middleware user-type checks.
   - The exact-root alias makes an already-preserved `/client-portal` safe, while new vanity-root journeys are normalized earlier by the resolver.

## Behavioral tests

- Update `server/src/test/unit/rootRedirect.test.ts` so matching portal-domain cases, including canonical-host-unavailable and non-standard-port lookup cases, expect `/client-portal/dashboard`.
- Add a runtime unit test for the new exact-root page: invoke the page with `next/navigation.redirect` mocked and assert it redirects to `/client-portal/dashboard`. Do not use a source-string/import-presence assertion.
- Keep and run the existing unknown-host, canonical-host, lookup-failure, domain-session, and vanity-middleware suites to guard unchanged behavior.
- Run the focused Vitest suites plus the relevant server typecheck/build target. Hocuspocus-only failures remain non-blocking per standing order.

## Smoke coverage

- Vanity host `/` completes canonical sign-in/domain-session exchange and lands on the same vanity host at `/client-portal/dashboard` without a 404.
- An authenticated direct request to `/client-portal` redirects to `/client-portal/dashboard`.
- Canonical application `/` still redirects to `/msp/dashboard`.
- An unknown host retains the MSP-dashboard fallback.

## Deliberate non-goals

- Do not commit, attach, or inspect the credential-bearing customer HAR beyond the already-redacted card description.
- Do not address the separately reported password-reset email/log issue.
- Do not redesign the client portal, duplicate the dashboard component, broaden accepted return URLs, or change session/OTT security behavior.
- No `release-v1-5-feature` gate is needed because this is route correction with no new or changed UI.

## Risks and handling

- The worktree currently has an unrelated `package-lock.json` diff produced during environment wiring. Do not include it in the plan commit or implementation unless the implementation step proves it is required.
- Redirect behavior can be obscured by middleware or auth state, so tests must exercise the resolver and page redirect as runtime functions, and smoke must cover both authenticated direct-root and full vanity-domain login flows.
