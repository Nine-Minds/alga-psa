# Scratchpad — App-relative redirects

PSA ticket: alga-2026-0003151.

## Research (2026-11-16)

- Go route: `server/src/app/msp/go/[target]/route.ts`, added 2026-10-28 (commits e9cdebc1f5, 9c2fb73e4a; alga-2026-0002876). Builds `new URL(destination, request.nextUrl.origin)` and calls `NextResponse.redirect`.
- Routing table: `packages/types/src/constants/productRoutes.ts` (`productNavHref(target)` -> `/msp/go/${target}`, `PRODUCT_NAV_DESTINATIONS` per product, `PROVIDER_SETUP_ENTRY_PATH`, `MAILBOX_SETUP_ENTRY_PATH`, `CALENDAR_SETUP_ENTRY_PATH`).
- Go-link users: `MicrosoftIntegrationSettings.tsx` (about line 788), `MicrosoftProviderForm.tsx` (728, 750), `EmailProviderConfiguration.tsx` (589), `integrationHealthActions.ts` (88), `ee/server/src/components/settings/profile/ConnectSsoClient.tsx` (402), `microsoftActions.ts` (1215, admin consent `returnTo` = public base URL + go path), `server/src/app/api/auth/microsoft/email-setup/callback/route.ts` (168).
- Why the origin is wrong: `ee/server/src/lib/mcp/baseUrl.ts` comment: behind Istio/CloudFront `req.nextUrl.origin` is the internal upstream origin (localhost:3000). That file carries `// LEVERAGE: pattern public-base-url`.
- Existing helpers: `server/src/lib/deployment/requestHost.ts` (`resolveRequestHost`, `resolveRequestProto`, `resolveRequestOrigin(request, caps, { fallbackProto, fallbackHost })`; forwarded host honoured only when `caps.trustForwardedHost`), `getDeploymentBaseUrl()`, `resolvePublicBaseUrl` in the MCP base URL file. `server/src/middleware.ts` about lines 444-456 computes `requestOrigin` with `resolveRequestOrigin` and notes next-auth rewrites `request.nextUrl` to NEXTAUTH_URL in middleware.
- Other request-origin redirect sites found so far: `server/src/lib/api/controllers/ApiMetadataController.ts:618`, `server/src/app/auth/mobile/handoff/route.ts:42`, `ee/packages/microsoft-teams/src/lib/teams/handleTeamsAuthCallback.ts:273`, `server/src/middleware/authorizationMiddleware.ts`. E2E-only Google routes can be allow-listed.
- Tests: `server/src/test/unit/product/productNavDispatcher.test.ts` asserts absolute `https://psa.example.com/...` Location values and must move to relative expectations. Related: `productNavDestinations.contract.test.ts`, `providerSetupReachability.test.ts`, `uiReachabilityCoherence.contract.test.ts`, `server/src/test/unit/api/microsoftEmailSetupCallback.test.ts`.

## Decisions

- Relative `Location` rather than resolving a public origin. It is correct on hosted, custom domains, appliance and local dev without deciding whether to trust forwarded headers, and it is the smaller mechanism. `NextResponse.redirect` cannot emit it, hence the helper.
- Absolute-URL needs stay on the public base URL helpers; unifying those is the existing `public-base-url` leverage item, not this plan.

## To record during implementation

- Full list of sites found by the sweep and which were moved, left, or allow-listed, with reasons.
- Result of checking the mobile handoff client against a relative `Location`.

## Implementation results (Draft Implementation)

Helper: `redirectToAppPath` in `packages/core/src/lib/redirectToAppPath.ts`, imported as `@alga-psa/core/redirectToAppPath` (placed in core, not `server/src/lib/deployment`, because `ee/packages/microsoft-teams` cannot import from `server/`). Relative `Location`, 307 default, only single-slash app paths (rejects scheme, `//`, backslashes, control chars, and `/.//host` after normalisation), `carryQuery` merges without overriding destination params (repeated carried keys keep all values). No env/config reads.

### Sweep (all `.redirect(` call sites in handlers/controllers/packages, excluding middleware.ts)

Moved to the helper:
- `server/src/app/msp/go/[target]/route.ts` — the bug.
- `server/src/lib/api/controllers/ApiMetadataController.ts` — `/api/v1/meta/openapi` redirect.
- `server/src/app/auth/mobile/handoff/route.ts` — the three `/auth/signin` redirects. The `callbackUrl` param is now path+query instead of `url.toString()` (which carried the internal origin).
- `ee/packages/microsoft-teams/src/lib/teams/handleTeamsAuthCallback.ts` — reauth redirect via `buildTeamsReauthPath` (`buildTeamsReauthUrl` left exported, still unit-tested).
- `server/src/app/api/email/oauth/imap/callback/route.ts` — found by the sweep, not in the original list: fallback was `url.origin`. No stored `redirectUri` -> `redirectToAppPath('/')`; a stored relative path stays relative; a stored absolute URL stays absolute (public base captured at flow start). Behaviour change: a garbage non-URL, non-path `redirectUri` now throws into the existing catch instead of resolving against the origin.

Left absolute (not request-derived, or legitimately absolute):
- `ee/server/.../microsoft/entra/callback`, `ee/server/.../integrations/ninjaone/callback`, `packages/integrations/.../qbo/{connect,callback}`, `.../xero/{connect,callback}`, `ee/packages/calendar/.../microsoft/calendar/callback`: built from `NEXTAUTH_URL` / `NEXT_PUBLIC_BASE_URL` env, not the request. Same-app, but consolidating them is the separate `public-base-url` item. Not changed.
- `connect.ts` authorize URLs, `api/mcp/oauth/authorize` (OAuth provider / client redirect targets), `marketing/track/click` (external destination), `ext-ui` 308 to runner base, mobile handoff redirect to the custom-scheme `redirectUrl`, e2e Google `authorize`: third-party / absolute by nature.
- `server/src/app/api/auth/microsoft/email-setup/callback/route.ts`: no redirect; returns HTML with `returnTo` built from the public base URL.

Allow-listed in the contract test (reason recorded there):
- `server/src/app/api/auth/e2e/google/complete/route.ts` — E2E-only.

`server/src/middleware/authorizationMiddleware.ts`: **not changed.** It is not imported anywhere (`server/index.ts` imports the Express port in `middleware/express/authMiddleware.ts`; `middleware.ts` does not use it), so it is dead code and cannot be wrong on hosted. If it is ever wired in, it would need the `resolveRequestOrigin` treatment from `middleware.ts`. Contract test scope excludes middleware.

### Mobile handoff check
`ee/mobile/src/screens/SignInScreen.tsx` opens `/auth/signin?callbackUrl=<handoff>` with `WebBrowser.openAuthSessionAsync` (ASWebAuthenticationSession / Custom Tabs, a real system browser) and only parses the final custom-scheme `alga://auth/callback`. The `/auth/signin` redirects are followed by that browser, which resolves a relative `Location`. The mobile app's own HTTP stack never sees them. Confirmed from source only; not tested on a device. The final redirect to the app's custom scheme stays absolute.

### Not verified
- Hosted behaviour (needs post-deploy check of `/msp/go/{mailbox,providers,calendar}`).
- Microsoft admin consent round trip.
- Mobile sign-in on a device.

### Verification note
`tsc --noEmit` for `server` runs out of memory at a 12GB heap here; it passes with `NODE_OPTIONS=--max-old-space-size=20000`. `packages/core` and `ee/packages/microsoft-teams` typecheck clean; core `tsup` build emits `dist/lib/redirectToAppPath.js`.
