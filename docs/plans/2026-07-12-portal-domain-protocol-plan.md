# Portal domain protocol fix — implementation plan (2026-07-12)

## Problem

On premise/appliance deployments, requests to a vanity portal domain traverse two
proxy hops (the portal-domain ingress in front of the main ingress). Each hop
appends to `X-Forwarded-Proto` / `X-Forwarded-Host`, so the headers arrive
comma-joined (`"https, https"`). The root layout's `generateMetadata`
(`server/src/app/layout.tsx:45-51`) feeds the raw values into
`new URL(`${proto}://${host}`)`, which throws:

```
TypeError: Invalid URL
  code: 'ERR_INVALID_URL',
  input: 'https, https://portal.digitalstrength.co.uk'
```

Because this is the root layout, every page render on the vanity domain 500s,
while the canonical host (one proxy hop, un-joined header) works fine.

A fourth site, `server/src/app/auth/client-portal/handoff/page.tsx:38`, splits
raw `x-forwarded-host` on `:` but never on `,` — with a doubled header the
tenant-locale lookup receives `"portal.x, portal.x"` and silently fails (soft
failure, wrong/missing locale).

Two sites already parse correctly by hand
(`server/src/middleware/express/authMiddleware.ts:57-58`,
`server/src/app/api/client-portal/domain-session/route.ts:232-234`) — the same
shape written repeatedly, i.e. a missing layer.

## Approach (approved in design session)

Extend the existing edge-safe forwarded-header layer,
`server/src/lib/deployment/requestHost.ts`, with proto/origin helpers, and
migrate all four call sites onto it. Two trust decisions were made explicitly:

- **Host is caps-gated.** `X-Forwarded-Host` is honored only when
  `caps.trustForwardedHost` is true (appliance profile), matching the existing
  `resolveRequestHost` semantics. This *changes hosted behavior* in the layout:
  hosted `metadataBase` comes from the `Host` header only — closing a
  host-injection hole. Hosted ingress preserves `Host`, so real traffic is
  unaffected.
- **Proto is parsed in all profiles.** Every deployment terminates TLS at a
  proxy; a spoofed proto is low-risk (wrong scheme in the requester's own
  response at worst). First comma-token, trimmed, lowercased, validated.

## Step 1 — helpers in `server/src/lib/deployment/requestHost.ts`

Add two functions (same edge-safe, dependency-free style as the file's existing
exports, with doc comments matching the file's voice):

```ts
/** First comma-token of X-Forwarded-Proto, trimmed + lowercased. Returns null
 *  when the header is absent or the token is not a plausible URL scheme, so
 *  callers keep their own fallbacks. Parsed in all deployment profiles. */
export function resolveRequestProto(
  request: { headers: { get(name: string): string | null } }
): string | null
```

- Take `x-forwarded-proto`, `split(',')[0].trim().toLowerCase()`.
- Validate against `/^[a-z][a-z0-9+.-]*$/` (URL scheme grammar); return `null`
  on absent header, empty token, or validation failure. This guarantees the
  value can never make `new URL()` throw.

```ts
/** Effective request origin as a URL. Host follows resolveRequestHost
 *  (caps-gated X-Forwarded-Host); proto follows resolveRequestProto with the
 *  caller-supplied fallback. Never throws on any header input. */
export function resolveRequestOrigin(
  request: { headers: { get(name: string): string | null } },
  caps: DeploymentCapabilities,
  options: { fallbackProto: string; fallbackHost: string }
): URL
```

- Host: `resolveRequestHost(request, caps).hostHeader`, falling back to
  `options.fallbackHost` when empty (layout needs `localhost:3010`).
- Proto: `resolveRequestProto(request) ?? options.fallbackProto`.
- Construct `new URL(`${proto}://${host}`)`. The host header could still in
  principle contain URL-hostile characters, so wrap the construction in a
  try/catch that falls back to
  `new URL(`${options.fallbackProto}://${options.fallbackHost}`)` — the
  never-throws guarantee is the point of the helper.

## Step 2 — `server/src/app/layout.tsx` (the crash fix)

Replace lines 45–51's raw header parsing:

```ts
const headersList = await headers();
const caps = resolveDeploymentCapabilities();
const rawHost = headersList.get('x-forwarded-host') || headersList.get('host') || '';
const metadataBase = resolveRequestOrigin(headersList-as-request, caps, {
  fallbackHost: 'localhost:3010',
  fallbackProto: rawHost.includes('localhost') ? 'http' : 'https',
});
```

Notes:
- `headers()` returns a `Headers`-like object that already satisfies the
  `{ headers: { get } }` shape via a tiny inline wrapper:
  `{ headers: headersList }`.
- Preserve the existing fallback heuristic (`localhost → http`, else `https`)
  for the proto fallback. Base the heuristic on the *resolved* host
  (`resolveRequestHost(...).hostHeader || 'localhost:3010'`) rather than the
  old unconditional-XFH host, so the heuristic and the URL agree.
- Import `resolveDeploymentCapabilities` from
  `@/lib/deployment/deploymentProfile` and the helpers from
  `@/lib/deployment/requestHost` (check the file's existing import aliasing —
  layout.tsx uses `@/` for app-local imports).

## Step 3 — `server/src/app/auth/client-portal/handoff/page.tsx`

In `resolveLocale()` (lines 36–48), replace the hand-rolled
`(xfh || host).split(':')[0]` with:

```ts
const caps = resolveDeploymentCapabilities();
const { hostname } = resolveRequestHost({ headers: headersList }, caps);
```

and pass `hostname` to `getTenantLocaleByDomain`. Keep the existing
empty-host → `null` early return and the try/catch.

Note this is also a trust-model change on hosted (XFH no longer honored) —
intended, per the design decision.

## Step 4 — `server/src/app/api/client-portal/domain-session/route.ts`

Lines 232–234: replace the inline proto parsing with

```ts
const requestScheme =
  resolveRequestProto(request) ?? requestUrl.protocol.replace(/:$/, '');
```

Behavior-identical (the route already took the first comma token); this just
moves it onto the shared layer.

## Step 5 — `server/src/middleware/express/authMiddleware.ts`

`getRequestOrigin` (lines 56–62): Express headers are a plain record, so adapt:

```ts
const headerAdapter = {
  headers: {
    get: (name: string) => {
      const v = req.headers[name.toLowerCase()];
      return Array.isArray(v) ? v[0] ?? null : v ?? null;
    },
  },
};
const caps = resolveDeploymentCapabilities();
const { hostHeader } = resolveRequestHost(headerAdapter, caps);
const protocol = resolveRequestProto(headerAdapter) ?? req.protocol ?? 'http';
const host = hostHeader || 'localhost';
return `${protocol}://${host}`;
```

**Deliberate behavior change:** the old code preferred `Host` over XFH; the
helper prefers XFH when trusted (appliance — where the proxy rewrites `Host`,
so this is a correction) and ignores XFH when not (hosted — where the old code
only used XFH as a fallback when `Host` was missing, a case that effectively
doesn't occur). `NEXTAUTH_URL` still short-circuits callers when set.

If the adapter shape gets reused a third time, extract it — but two sites
(this file only, today) does not yet earn a layer.

## Step 6 — tests

Extend `server/src/test/unit/resolveRequestHost.test.ts` (or a sibling
`requestOrigin.test.ts` in the same directory if the existing file's scope
reads wrong for proto tests):

- `resolveRequestProto`: absent header → null; `"https"` → `https`;
  `"https, https"` → `https`; `"HTTPS , http"` → `https`; garbage
  (`"foo bar"`, `""`, `" , https"`) → null.
- `resolveRequestOrigin`: the exact production repro — caps =
  appliance, `x-forwarded-proto: "https, https"`,
  `x-forwarded-host: "portal.digitalstrength.co.uk, portal.digitalstrength.co.uk"`
  → `https://portal.digitalstrength.co.uk/` and **does not throw**.
- Caps gating: hosted profile ignores XFH for the origin host; appliance
  honors it.
- Fallbacks: no forwarded headers → fallbackProto/fallbackHost used;
  URL-hostile host header → falls back rather than throwing.

Run the touched suites plus the existing forwarded-host ones:

```
cd server && npx vitest run src/test/unit/resolveRequestHost.test.ts \
  src/test/unit/forwardedHostRewrite.test.ts \
  src/test/unit/middleware.vanityClientPortalRedirect.test.ts \
  src/test/unit/portalDomainSessionOtt.test.ts
```

## Step 7 — verification (live)

The wired dev stack for this worktree serves http://localhost:3019.

1. Baseline repro: `curl -sS -o /dev/null -w '%{http_code}' http://localhost:3019/auth/signin -H 'x-forwarded-proto: https, https' -H 'x-forwarded-host: portal.example.test, portal.example.test'` — before the fix this 500s (root layout throws); after the fix it must return the normal status (307/200).
2. Confirm no regression on plain requests: same curl without the doubled
   headers.
3. `cd server && NODE_OPTIONS=--max-old-space-size=24576 npx tsc --noEmit`
   (full-repo tsc needs the big heap).

## Out of scope

- The `ReadableStream is already closed` exceptions and the
  "consumer group already exists" log chatter seen alongside the production
  error — separate symptoms, not touched here.
- Fixing header duplication at the ingress/proxy layer — the app must be
  robust to comma-joined forwarded headers regardless.
