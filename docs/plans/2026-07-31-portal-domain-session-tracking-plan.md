# Fix: Client portal login redirect loop on custom portal domains (ALGA0002205)

**Branch:** `fix/alga0002205`
**Status:** Approved plan, not yet implemented

## Problem

On a custom (vanity) client portal domain, sign-in succeeds on the canonical host but the
user is bounced straight back to the login page, indefinitely. Confirmed in production;
affects every hosted tenant with an ACTIVE custom portal domain. Canonical-host portal
login is unaffected.

## Root cause

Custom-domain sign-in happens on the canonical host and hands off to the vanity host via a
one-time token (OTT). The OTT's `userSnapshot` is built inside the NextAuth `signIn`
callback from hand-built token literals (`packages/auth/src/lib/nextAuthOptions.ts:1803`
and `:1856`, plus the EE duplicates at `:2670` and `:2709`) containing only
`id, email, name, tenant, tenantSlug, user_type, clientId, contactId` — **no `session_id`**.

This is structural, not an oversight a caller can fix: NextAuth runs `signIn` before
`jwt`, and the `sessions` row is only created in the `jwt` callback
(`nextAuthOptions.ts:1973–2002`), so no session id exists yet at OTT-mint time. When the
`signIn` callback returns the vanity redirect, the `jwt` callback never runs on the
canonical host either — so these logins produce **zero** `sessions` rows.

Consequently the `session_id` passthrough in `computeVanityRedirect`
(`nextAuthOptions.ts:545`) always resolves to `undefined`, and
`/api/client-portal/domain-session` mints the portal cookie via
`encodePortalSessionToken` with no `session_id`. Since the durable-revocation enforcement
change (2026-07-24), `requireLiveSession()` in `packages/auth/src/lib/getSession.ts:31–38`
fails closed on a missing tracked session id, so `/client-portal/dashboard` throws
`AuthenticationError` and the user loops back to login. The same guard exists in the `jwt`
callback (`rejectRevokedOrUnverifiableSession`, `nextAuthOptions.ts:2029`), which would
reject the cookie on any NextAuth-decoded request too.

**Security note:** the fail-closed gate is correct and must not be weakened. Before it,
vanity-domain portal sessions were effectively unrevocable (no `sessions` row means SCIM
deactivation, admin revoke, and sign-out-everywhere had no effect until JWT expiry). The
fix makes these sessions revocable for the first time.

## Design

Create the `sessions` row at **OTT redemption** in
`server/src/app/api/client-portal/domain-session/route.ts` and stamp its id into the token
minted by `encodePortalSessionToken` — rather than trying to carry a session id forward
from `signIn`, where none can exist.

Decisions made:

1. **Reuse-if-present, else create.** If `userSnapshot.session_id` is already a non-empty
   string, keep it and do not create a row. This honors the existing passthrough design
   and mirrors the `jwt` callback's own "only create if `session_id` doesn't exist" guard.
   Today the snapshot never carries one, so in practice the route always creates.
2. **Fail closed on creation failure.** If `UserSession.create` throws, return the
   existing `exchange_failed` 500 rather than minting a cookie that is guaranteed to
   bounce. (The OTT is consumed at that point; the user retries login — acceptable for a
   rare DB failure, and strictly better than a silent loop.)
3. **Record the true login method.** Add `login_method` to the four hand-built token
   literals in the `signIn` callbacks (CE credentials, CE OAuth, EE credentials, EE OAuth)
   so it flows through the existing `login_method` passthrough at
   `nextAuthOptions.ts:546` into the snapshot. At redemption, use
   `userSnapshot.login_method ?? 'credentials'` for the session row and keep it in the
   minted token payload.
4. **Device info from the redemption request.** The vanity-host request is the browser
   that will own the session, so derive `ip_address` / `user_agent` /
   fingerprint / device name/type from it using the existing helpers (`getClientIp`,
   `generateDeviceFingerprint`, `getDeviceInfo` — all exported from `@alga-psa/auth`).
5. **Parity with sign-in session tracking:** enforce the platform max-sessions policy
   (`UserSession.enforceMaxSessions`, limit 5 — same hardcoded platform constant as the
   `signIn` callback) before creating, set `expires_at = now + getSessionMaxAge()` to
   match the minted JWT's `exp`, and fire-and-forget the async location update
   (`getLocationFromIp` → `UserSession.updateLocation`) as the `jwt` callback does.

Downstream interplay (verified, no changes needed):

- The minted JWT carries `session_id`, so the `jwt` callback's create-guard
  (`user && !token.session_id`) stays a no-op, `rejectRevokedOrUnverifiableSession` finds
  a live row, the `session` callback copies `session_id` onto the session object, and
  `requireLiveSession()` passes.
- The sliding-expiry logic in the `jwt` callback (`UserSession.extendExpiry`) picks the
  session up on first request (no `last_session_extend` in the minted token) and keeps the
  row in step with the rolling JWT.

## Implementation steps

### 1. `server/src/app/api/client-portal/domain-session/route.ts`

After `consumePortalDomainOtt` succeeds (line ~230):

- If `userSnapshot.session_id` is a non-empty string, proceed unchanged.
- Otherwise:
  - Derive device info from the incoming request: `getClientIp(request)`,
    `request.headers.get('user-agent')`, `generateDeviceFingerprint(userAgent)`,
    `getDeviceInfo(userAgent)`.
  - `await UserSession.enforceMaxSessions(tenant, userId, 5)` — tenant from
    `portalDomain.tenant`, userId from `userSnapshot.id`.
  - `const sessionId = await UserSession.create({...})` with
    `expires_at = new Date(Date.now() + getSessionMaxAge() * 1000)` and
    `login_method = userSnapshot.login_method ?? 'credentials'`.
  - Fire-and-forget `getLocationFromIp(ip).then(loc => UserSession.updateLocation(...))`
    with a `.catch` that only logs.
  - Mint the token from `{ ...userSnapshot, session_id: sessionId, login_method }`.
- Any thrown error from enforce/create falls through to the existing catch → 500
  `exchange_failed` (fail closed; no cookie without a tracked session).

Imports: `UserSession` from `@alga-psa/db/models/UserSession`; `getClientIp`,
`generateDeviceFingerprint`, `getDeviceInfo`, `getSessionMaxAge`, and `getLocationFromIp`
are all already exported from `@alga-psa/auth` — no new exports needed.

### 2. `packages/auth/src/lib/nextAuthOptions.ts` — four token literals

Add `login_method` to the hand-built literals passed to `computeVanityRedirect`:

- CE OAuth block (~line 1803): `login_method: providerId`
- CE credentials block (~line 1856): `login_method: 'credentials'`
- EE OAuth block (~line 2670): `login_method: providerId`
- EE credentials block (~line 2709): `login_method: 'credentials'`

No other changes to the auth callbacks. (Do **not** attempt to add `session_id` here —
none exists at this point in the NextAuth lifecycle; that is the bug.)

### 3. Tests — `server/src/app/api/client-portal/domain-session/route.test.ts`

Extend the existing vitest suite (mock `UserSession` and the location helper):

- Happy path: redemption creates a session row with the snapshot's tenant/user, the
  request's device info, and `login_method` from the snapshot; the minted JWT payload
  (decode it in the test, as existing tests do for the cookie) contains the new
  `session_id`.
- Reuse path: snapshot already carrying `session_id` → `UserSession.create` is **not**
  called and the minted token keeps the snapshot's id.
- Fail-closed path: `UserSession.create` rejects → response is 500 `exchange_failed` and
  no session cookie is set.
- `login_method` fallback: snapshot without `login_method` → row created with
  `'credentials'`.
- Existing tests must continue to pass (they'll need the new mocks wired in).

### 4. Verification

- `npx vitest run server/src/app/api/client-portal/domain-session/route.test.ts`
- Typecheck the touched packages (`npx tsc --noEmit` scoped per workspace convention, or
  `npx nx build-deps server` as this worktree already requires).
- Optional live smoke on the dev stack (http://localhost:3297): a full vanity-domain
  hand-off needs a second hostname mapped to the dev server; if impractical locally, rely
  on the unit suite — the redemption route is the single choke point and is fully covered
  by it.

## Out of scope

- Backfilling or revoking the untracked portal JWTs already in the wild — they expire on
  their own (24 h default) and are rejected by the live-session gate today.
- The stale CORS error seen in devtools (downstream symptom of the bounce).
- Any relaxation of `requireLiveSession()` / `rejectRevokedOrUnverifiableSession` —
  explicitly not to be rolled back.
- The duplicated CE/EE option-builder blocks in `nextAuthOptions.ts` (a `LEVERAGE`
  candidate, but not this fix).

## Acceptance

- Custom-domain portal login lands on `/client-portal/dashboard` and stays signed in.
- Every OTT redemption yields exactly one `sessions` row; admin revoke / SCIM
  deactivation / sign-out-everywhere now terminate vanity-domain portal sessions.
- Canonical-host portal login behavior unchanged.
