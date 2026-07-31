# Custom Portal Domain — Root Path Redirects to Client Portal

- Date: 2026-07-22
- Branch: `fix/appliance-custom-portal-domain-redirect`
- Worktree: `/home/robert/alga-psa.worktrees/fix-appliance-custom-portal-domain-redirect`
  (recreated here after the original `alga-cow-copies` checkout was lost to btrfs image
  corruption on 2026-07-22; original base `252e607866`, recreated off `origin/main`
  `3fd91b8652`)
- Reporter: Peet McKinney (Artichoke Consulting) — `https://portal.artichoke.tech/` (a
  registered, active, correctly-proxied portal domain) redirected to the MSP sign-in
  instead of the client portal; only `/client-portal` worked.

## Objective

The bare root of a registered portal domain (`https://portal.example.com/`) redirects to
`/client-portal` on the same host, letting the existing vanity middleware chain take over
(canonical sign-in with `portalDomain` branding + callback, or straight into the portal for
authenticated clients). Behavior on the canonical host and on unknown hosts is unchanged.

## Root cause

`server/src/app/route.tsx` — the handler for `/` — unconditionally does
`redirect('/msp/dashboard')`. The middleware's vanity-host logic
(`server/src/middleware.ts`) only covers `/client-portal/*` and
`/auth/client-portal/signin`, so `/` on a portal domain never consults the request host.

## Settled design decisions (from the design session)

1. **Target:** root → `redirect('/client-portal')` (relative; browser stays on the vanity
   host). Downstream auth/branding/callback handling is already implemented in middleware —
   do not duplicate it.
2. **Which hosts:** DB-checked via `getPortalDomainByHostname` (the same unscoped
   tenant-discovery lookup the domain-session exchange uses). A row in **any status**
   (`active`, `pending_dns`, `disabled`, …) redirects to the portal — the row's existence
   means "this host is a portal domain"; `active` gates the session exchange downstream,
   not the intent of the root URL. Unknown/stray hosts keep today's MSP behavior.
3. **Scope:** root path only. `/msp/*` and MSP auth pages on a portal-domain host are out
   of scope (possible future hardening, separate design).
4. **No UI/docs changes** in this branch — the redirect makes the `/client-portal` path an
   implementation detail, which was the reporter's primary suggestion.
5. **Approach:** fix in the Node-runtime root route handler (it can reach the DB). Edge
   middleware and `next.config.js` host redirects were ruled out (no DB access / static
   config respectively).

## Implementation

### 1. Decision helper (new, unit-testable)

Add `resolveRootRedirect` to a new module `server/src/lib/deployment/rootRedirect.ts`:

```ts
export type RootRedirectTarget = '/client-portal' | '/msp/dashboard';

export async function resolveRootRedirect(args: {
  hostname: string;            // from resolveRequestHost (port stripped)
  hostHeader: string;          // as received, may include port
  canonicalHostname: string | null;  // null when NEXTAUTH_URL unset/unparseable
  lookupPortalDomain: (candidate: string) => Promise<unknown | null>;
}): Promise<RootRedirectTarget>
```

Decision table, in order:

1. `canonicalHostname` set and `hostname === canonicalHostname` → `/msp/dashboard`
   (fast path — no DB touched; the overwhelming majority of traffic).
2. Otherwise build host candidates mirroring
   `server/src/app/api/client-portal/domain-session/route.ts` (`hostCandidates`): if
   `hostHeader` carries a non-80/443 port, try `host:port` first, then bare `hostname`.
   First candidate with a `lookupPortalDomain` hit → `/client-portal`.
3. No match → `/msp/dashboard`.
4. `lookupPortalDomain` throws → log a warning (with hostname), return `/msp/dashboard`
   (fail toward today: an outage never locks MSP users out or behaves worse than status quo).

Empty/missing host falls out naturally: matches neither canonical nor any row → MSP.

### 2. Route handler (`server/src/app/route.tsx`)

Rewrite `GET` to:

- Build a `Request`-shaped header reader from `await headers()` (next/headers).
- `caps = resolveDeploymentCapabilities()`; `resolveRequestHost(request, caps)` for
  `{ hostname, hostHeader }` — appliance `X-Forwarded-Host` trust applies as elsewhere.
- `canonicalHostname` from `NEXTAUTH_URL` (try/catch → `null`), mirroring middleware's
  `getCanonicalUrl()`.
- Inject `lookupPortalDomain` as `(candidate) => getPortalDomainByHostname(knex, candidate)`
  with `knex = await getAdminConnection()` — created lazily, only after the canonical fast
  path fails.
- `redirect(await resolveRootRedirect(...))`.

Query strings on `/` are dropped (nothing meaningful lives at root-with-query).

### 3. Tests

Per `docs/AI_coding_standards.md`, tests live centralized under `server/src/test/unit/`,
mirroring source structure.

- **`server/src/test/unit/rootRedirect.test.ts`** — decision table with an injected fake
  lookup: canonical host → MSP and lookup not called; lookup hit → `/client-portal`
  (helper is status-agnostic — any row qualifies); unknown host → MSP; lookup throws → MSP
  (and warning logged); `canonicalHostname: null` → lookup still consulted; ported host
  tries `host:port` candidate before bare hostname.
- **Handler-level test** (same file or `server/src/test/unit/app/route.test.ts`,
  mocking the helper, `getAdminConnection`, and `next/headers`): redirect `Location` for
  portal vs non-portal outcomes; assert `getAdminConnection` is **not** called on the
  canonical fast path (guards the hot path against regression).
- **No e2e** — the downstream chain (vanity `/client-portal` → canonical sign-in → OTT
  exchange) is already covered by `middleware.vanityClientPortalRedirect.test.ts` and the
  domain-session tests.

### 4. Manual verification (requires dev-stack wire-up in this worktree)

The previously running dev stack (port 3553, compose project `alga-psa-local-test`:
pgbouncer `localhost:6472`, redis `6380`) still serves from the old read-only copy. Before
manual verification, re-wire this worktree (per the lane's Wire Up conventions: dev port
3553, same compose project, secrets copied from the previous lane's `secrets/`):

- `curl -sI http://localhost:3553/` → `/msp/dashboard` (canonical host unchanged).
- Simulate a vanity host: insert/point a `portal_domains` row at a test hostname, then
  `curl -sI -H 'Host: <test-host>' http://localhost:3553/` → `Location: /client-portal`.
- With `DEPLOYMENT_PROFILE=appliance`, `curl -sI -H 'X-Forwarded-Host: <test-host>'`
  (Host = canonical) → `Location: /client-portal` (XFH trust honored).
- `curl -sI -H 'Host: unknown.example.com' http://localhost:3553/` → `/msp/dashboard`.

## Out of scope

- Portal-domain hosts serving `/msp/*` or MSP auth pages (host-wide "portal-only" hardening).
- Settings UI / docs copy about the portal URL.
- Caching the domain lookup (low-QPS path; status changes must take effect immediately).

## Commit plan

Single commit: helper + handler + unit tests. (This plan doc was committed separately first.)
