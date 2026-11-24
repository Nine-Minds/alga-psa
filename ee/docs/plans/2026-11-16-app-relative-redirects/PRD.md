# PRD — Same-app redirects never depend on the request origin

- Slug: `app-relative-redirects`
- Date: `2026-11-16`
- Status: Draft
- PSA ticket: alga-2026-0003151

## Summary

The `/msp/go/<target>` product navigation route answers with a redirect to `http(s)://localhost:3000/...` on hosted, because it builds an absolute URL from `request.nextUrl.origin`, which behind the proxy is the internal upstream origin. Every "go" link is affected: provider setup, mailbox setup, calendar setup, integration health banners, the SSO connect screen and the return from Microsoft admin consent. This plan gives route handlers one way to redirect inside the app that does not involve an origin at all, moves the go route and the other request-origin redirects onto it, and adds a contract test so the pattern does not come back.

## Problem

`server/src/app/msp/go/[target]/route.ts` (added 2026-10-28 for alga-2026-0002876):

```ts
const url = new URL(destination, request.nextUrl.origin);
...
return NextResponse.redirect(url, { status: 307, headers: { 'Cache-Control': 'no-store' } });
```

Behind Istio/CloudFront `request.nextUrl.origin` is the internal origin. `ee/server/src/lib/mcp/baseUrl.ts` documents exactly this and already carries `// LEVERAGE: pattern public-base-url`. The browser receives `Location: https://localhost:3000/msp/settings/integrations?...` and the user lands on a dead page.

Callers of the go route (all broken on hosted):

- `packages/integrations/src/components/settings/integrations/MicrosoftIntegrationSettings.tsx` ("Connect a mailbox")
- `MicrosoftProviderForm.tsx`, `EmailProviderConfiguration.tsx`
- `integrationHealthActions.ts` (health banner links)
- `ee/server/src/components/settings/profile/ConnectSsoClient.tsx`
- `microsoftActions.ts` (`returnTo` for the Microsoft admin consent return) and `server/src/app/api/auth/microsoft/email-setup/callback/route.ts`

The same shape exists elsewhere and is wrong for the same reason, or right only by accident:

- `server/src/lib/api/controllers/ApiMetadataController.ts` (`new URL('/api/v1/meta/openapi', apiRequest.nextUrl.origin)`)
- `server/src/app/auth/mobile/handoff/route.ts` (`new URL('/auth/signin', url.origin)` from `req.url`)
- `ee/packages/microsoft-teams/src/lib/teams/handleTeamsAuthCallback.ts` (`requestUrl.origin`)
- `server/src/middleware/authorizationMiddleware.ts` (`new URL(..., req.url)`)

The implementer sweeps for the rest; this list is from a partial search.

## Goals

1. Every `/msp/go/<target>` link lands on the correct page on hosted, on tenant custom domains, on an appliance and in local development.
2. A route handler that redirects to a path inside the app cannot get the host wrong, because it never supplies one.
3. The request-origin pattern is prevented by a test.

## Non-goals

- Building a general public-base-URL resolver. Redirects that must be absolute (OAuth redirect URIs, links in emails, links handed to a third party) keep using the existing public base URL helpers; consolidating those is the separate `public-base-url` leverage item.
- Changing the go route's destinations or the product routing table in `packages/types/src/constants/productRoutes.ts`.
- Changing middleware origin handling (`server/src/middleware.ts` already resolves its origin through `resolveRequestOrigin`).

## Users and Primary Flows

- An MSP admin on hosted clicks "Connect a mailbox" on the Microsoft provider screen and arrives at the mailbox setup tab on their own AlgaPSA address.
- An MSP admin finishes Microsoft admin consent and is returned to provider settings instead of localhost.
- A user on a custom domain or an appliance follows the same links and stays on the host they were on.

## UX / UI Notes

No visible change other than the links working.

## Requirements

### Functional Requirements

**App-path redirect helper**

- Add one small server helper (suggested name `redirectToAppPath`, placed with the other request/deployment helpers under `server/src/lib/deployment/` or wherever shared route helpers live for packages that need it) that returns a redirect response whose `Location` is a relative reference: path plus query plus optional fragment.
- `NextResponse.redirect` requires an absolute URL, so the helper builds the response directly (`new NextResponse(null, { status, headers: { Location } })`). Browsers resolve a relative `Location` against the URL they requested, which is by definition the public one. No forwarded-header trust decision is involved.
- The helper accepts only an app path. It rejects anything that is not a single-slash-rooted path (no scheme, no `//host`, no backslash variants) so it cannot be turned into an open redirect, and it takes status (default 307) and extra headers.
- It can merge query parameters from the incoming request without overriding ones the destination already has (the go route's current behaviour).

**Go route**

- `server/src/app/msp/go/[target]/route.ts` uses the helper. Unknown targets still 404, query pass-through and `Cache-Control: no-store` are unchanged.

**Other request-origin redirects**

- Sweep route handlers and controllers in `server/src`, `ee/server/src`, `packages/*/src` and `ee/packages/*/src` for same-app redirects built from `request.nextUrl.origin`, `req.url`, `new URL(req.url).origin` or equivalent, and move each to the helper. Start with the four listed under Problem.
- Where a site needs an absolute URL for a real reason (it is embedded in a document, sent to a third party, or used as an OAuth parameter), leave it on the public base URL helper and note it in the scratchpad.
- Middleware `NextResponse.redirect(new URL(path, request.url))` is a different case: next-auth rewrites `request.nextUrl` there. Check `authorizationMiddleware.ts` against the origin middleware already computes, and fix it only if it is actually wrong on hosted.

**Contract test**

- A source-level contract test (alongside `uiReachabilityCoherence.contract.test.ts` and `productNavDestinations.contract.test.ts`) fails when a route handler passes a request-derived origin to a redirect. Allow-list by file with a reason for the cases that legitimately need it.

### Non-functional Requirements

- No behaviour change in local development, where the internal and public origins are the same.
- The helper has no environment or configuration dependency.

## Data / API / Integrations

No data change. HTTP behaviour change: the affected redirects return a relative `Location` (valid per RFC 9110) instead of an absolute one. `returnTo` values for Microsoft admin consent already use the public base URL plus the go path; they start working once the go route is fixed.

## Security / Permissions

- The helper refuses non-path input, which removes any chance of a redirect leaving the app through it.
- Relative `Location` removes the host-header and forwarded-host trust question from these redirects entirely.

## Observability

None needed.

## Rollout / Migration

Ship normally. After deploy, on hosted, request `/msp/go/mailbox`, `/msp/go/providers` and `/msp/go/calendar` while signed in and confirm the `Location` header is relative and the browser lands on the tenant's own host. Run one Microsoft admin consent round trip.

## Open Questions

- Any client that follows these redirects without resolving relative references? Browsers and fetch do. The mobile handoff route should be checked on a device or with the mobile client's HTTP stack before it is switched.

## Acceptance Criteria (Definition of Done)

- On hosted, every `/msp/go/<target>` link keeps the user on the host they started on.
- The Microsoft admin consent return lands on provider settings on hosted.
- No route handler in the swept directories builds a same-app redirect from the request origin, enforced by the contract test.
- Existing go-route tests pass with relative `Location` expectations, including query pass-through, unknown target and per-product destinations.
