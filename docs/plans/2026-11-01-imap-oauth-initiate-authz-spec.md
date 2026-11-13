# Spec — IMAP OAuth initiate/callback authorization (alga-2026-0003019)

Card `3c77a432` · finding from the security review of PR #4009 (merge `f958a142447b`).

## Finding (as filed)
`server/src/app/api/email/oauth/imap/initiate/route.ts:9-20` checks only that a user exists and that the tenant holds the
`email_to_ticket` product. It never rejects client-portal users and never checks `ticket_settings:update`. A ticket-settings
**reader** can therefore obtain a provider id from `getEmailProviders`, call `POST .../imap/initiate`, receive a valid
authorization URL and state for that provider, and — once they authorize an account they control — the callback
(`.../imap/callback/route.ts`) exchanges the code with the **tenant's stored client secret** and overwrites
`access_token`/`refresh_token`, marking the provider connected. Mailbox ingestion is then inoperable or, worse, pointed at
an attacker's mailbox.

## Second defect found while designing (same fix, and it is the more serious one)
`encodeState` is `base64(JSON)` — **unsigned** (`server/src/utils/email/oauthHelpers.ts:78-96`). `validateState` checks only
age. The callback is unauthenticated by nature (it is a browser redirect from the provider) and trusts `state.tenant`,
`state.providerId` and `state.userId` verbatim. Anyone who knows a tenant id and a provider id can craft a callback URL and
drive a token exchange with the tenant's client secret without ever calling `initiate`. The permission check on `initiate`
alone would be decorative.

## Invariant
Initiating and completing a provider credential exchange are the **same** operation and get the same authority
(`ticket_settings:update`, internal users only). The callback has no session, so its authority must be **carried from
initiate in a form the caller cannot forge or replay**, and re-confirmed at use time.

## Mechanism

### 1. `initiate` — gate the mutation
After `getCurrentUser()` and the existing product-access check:
- reject when `user.user_type !== 'internal'` → `403` (the route is an MSP settings surface; portal contacts own no provider);
- `await hasPermission(user, 'ticket_settings', 'update', knex)` → `403` when false, mirroring the guard the email
  settings UI already relies on (`server/src/test/unit/email/inboundPauseUi.contract.test.ts:15`) and importing it the way
  `server/src/app/api/documents/[documentId]/content/route.ts:10` does.

### 2. State becomes a signed, single-use grant
- `encodeState`/`decodeState` keep their names and signatures; the envelope becomes
  `<base64url(payload)>.<base64url(hmac-sha256(payload, key))>` with `key` from the app secret provider
  (`getSecretProviderInstance().getAppSecret('OAUTH_STATE_SIGNING_KEY')`). **Fail closed**: no key ⇒ the route errors, never
  falls back to unsigned. `decodeState` verifies with `timingSafeEqual` and returns `null` on mismatch — every existing
  caller already treats `null` as "invalid state".
- One migration: `email_oauth_grants (id uuid pk, tenant, provider_id, initiated_by_user_id, redirect_uri, created_at,
  expires_at, consumed_at)` with `id = state.nonce`.
- `initiate` persists the grant before returning the URL (10-minute expiry, matching `validateState`).

### 3. `callback` — close the trust boundary
Order, before any token exchange or write:
1. verify the HMAC via `decodeState` (rejects forged and tampered state);
2. `validateState` age check;
3. `tenant === state.tenant`, provider exists in that tenant, provider_type `imap` (unchanged);
4. **consume the grant atomically** — `update email_oauth_grants set consumed_at = now() where id = state.nonce and
   consumed_at is null and expires_at > now() returning *`; zero rows ⇒ `400 invalid or already-used state` (kills replay);
5. grant must match `tenant`, `provider_id` and `redirect_uri`;
6. **re-assert authority now**: the grant's `initiated_by_user_id` still exists, is `internal`, and still passes
   `hasPermission(..., 'ticket_settings', 'update')` in that tenant. A user demoted or deactivated between initiate and
   callback is refused and **no token is written**.
Only then does the existing exchange, pause-recovery and redirect logic run unchanged.

### 4. Same gate for the siblings
`server/src/app/api/email/oauth/initiate/route.ts` and `server/src/app/api/email/imap/reconnect/route.ts` perform the same
class of provider mutation; both get the `initiate` gate. Webhook routes are excluded — they authenticate their provider by
signature, not by user authority. **One helper**, `assertProviderMutationAuthority(user)`, so the next provider route cannot
reintroduce the gap.

## Tests
1. ticket-settings reader `POST /imap/initiate` → 403, no grant row, no URL.
2. client-portal user with the permission → 403.
3. forged state (payload edited, HMAC invalid) → 400 at callback, no token write.
4. unsigned legacy state → 400.
5. replay: a second callback with the same nonce → 400, tokens from the first exchange untouched.
6. expired grant → 400. Cross-tenant `providerId` in state → 404/403, no write.
7. permission revoked between initiate and callback → 403, `email_providers` row unchanged (assert digest of credentials).
8. happy path: internal user with `ticket_settings:update` completes the flow; tokens written exactly as today.
9. unit tests for `encodeState`/`decodeState`: round-trip, tamper, truncation, wrong key, missing key fails closed.

## Out of scope
No new permission verb (`ticket_settings:update` is the existing gate for provider settings). No change to the token
exchange itself, to webhook routes, or to already-stored connections. Existing in-flight authorizations (≤10 min) become
invalid when signing lands — acceptable, they re-initiate.

## Risks
- A missing `OAUTH_STATE_SIGNING_KEY` fails closed and breaks email setup until the secret exists: that is the correct
  failure, but it needs a documented provisioning step for every environment.
- All `encodeState` callers must land in one change or the two ends disagree; the compiler cannot see this, so the unit
  test asserting a legacy unsigned state is rejected is the guard.
- `hasPermission` at callback time runs on a request with no session — it must be called with an explicit user row resolved
  from the grant, never with `getCurrentUser()`.
