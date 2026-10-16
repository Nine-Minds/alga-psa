# CF007 — Microsoft authority, issuer binding and nonce

CF007 asks for a test-authority seam with "production issuer, signature, state,
nonce and audience checks preserved" and "no URL/request-selected issuer or
TLS/token-validation bypass".

Before adding a seam, the existing surfaces were read. Three defects were there
already, and all three are about checks that were **absent**, not bypassed — a
repo-wide scan found zero `NODE_TLS_REJECT_UNAUTHORIZED`, no `algorithms: ['none']`
and no signature-skip flags on any Microsoft path.

## What was repaired (commit `ae6fc508a7`)

### 1. Nonce was not verified on either Microsoft provider

`state` binds the callback to the browser that started it; `pkce` binds the code
to the client that requested it. Only `nonce` binds the **ID token** to this
authorization request, which is what stops a token minted for a different
request being replayed into this session. Auth.js sends and checks a nonce only
when it is listed in `checks`, and it was not.

The consequence had already been measured and written down by an earlier
workstream — `ee/docs/plans/2026-09-05-production-regression-prevention/microsoft-coverage-boundaries.md`:

> Observed one token request, zero JWKS requests and no nonce.

Worse, the two `AzureADProvider` registrations disagreed: the async one declared
`checks: ['pkce','state']`, the env-only fallback declared **no `checks` at all**,
so which verification posture a deployment ran under depended on which provider
it happened to build. Both now declare `['pkce','state','nonce']`.

### 2. OIDC discovery took the document at its word

A discovery document is self-asserted: whatever host answers names the `issuer`,
and that string becomes the trusted-issuer binding `verifyAgentToken` later
admits agent tokens against. OpenID Connect Discovery 1.0 §4.3 requires the
issuer to equal the one the discovery URL was derived from. That check did not
exist. It does now, before the value is cached or stored, together with
https-only transport for both the document and the `jwks_uri` (loopback http
excepted so a local emulator needs no certificate).

### 3. `discoveryBaseUrl` was safe only by omission

`POST /api/v1/mcp/idp-providers` destructures the request body into an explicit
field list that happens not to include `discoveryBaseUrl`. One `...body` spread
would turn a test seam into an attacker-selected issuer. Now pinned by
`server/src/test/unit/product/mcpIdpDiscoveryNotRequestSelected.contract.test.ts`,
which also asserts the seam still exists so the pin cannot pass vacuously.

## Two rules that would have been wrong, caught by measuring

Both were candidate designs; both are rejected, and the reasons are recorded in
the code so they are not re-proposed.

- **An issuer/JWKS same-origin rule is wrong.** Google advertises issuer
  `https://accounts.google.com` with keys at
  `https://www.googleapis.com/oauth2/v3/certs`. That rule would have rejected the
  built-in Google preset outright. Transport, not origin, is the invariant that
  holds across providers.
- **Strict issuer equality is wrong.** Microsoft's multi-tenant authorities
  answer with a *templated* issuer. Fetched live during this round:

  ```
  $ curl https://login.microsoftonline.com/common/v2.0/.well-known/openid-configuration
  issuer: https://login.microsoftonline.com/{tenantid}/v2.0
  jwks:   https://login.microsoftonline.com/common/discovery/v2.0/keys
  ```

  So `{tenantid}` stands for exactly one path segment and every other character
  must still match the URL that was requested.

## Evidence

| Check | Result |
|---|---|
| Pre-existing **live** discovery tests against real Google + Microsoft (`mcpIdpPresets.test.ts`) | 11/11 pass — this is what proves the new rules do not reject real providers |
| `mcpOidcDiscoveryHardening.test.ts` (new, offline) | 9 cases: cleartext refused, loopback allowed, non-absolute refused, cleartext JWKS refused, impersonated issuer refused, exact match accepted, Microsoft placeholder accepted, over-greedy placeholder refused, suffixed lookalike host refused |
| `mcpIdpDiscoveryNotRequestSelected.contract.test.ts` (new) | 3 cases |
| Nonce pin on both AzureAD registrations (`nextAuthOptions.mspContract.test.ts`) | scoped to the two AzureAD blocks; a third `checks` belongs to the Playwright fake-Google provider and is deliberately not matched |
| Mutation: drop `'nonce'` from one provider | contract fails |
| Mutation: disable the issuer-match check | 3 of 9 hardening cases fail (impersonated issuer, over-greedy placeholder, lookalike host) |
| `packages/auth` suite | 45 files / 193 tests pass |
| `scripts/tests/microsoft-oidc-harness.test.mjs` | 17/17 pass |

## What CF007 still needs — this row is NOT verified

- **Real application sign-in/callback execution.** The harness
  (`packages/auth/test-harness/run-microsoft-callback.mjs`) drives a real Next
  server against a loopback authority that preserves the
  `login.microsoftonline.com` issuer string and swaps transport only. It was not
  run this round, so there is no evidence that the application now *requests* a
  nonce end to end — only that it is configured to.
- **The emulator's Entra OIDC surface is still incomplete.** `packages/emulators/msgraph`
  serves `authorize`/`token`/`adminconsent` but has no
  `/{tenant}/v2.0/.well-known/openid-configuration`, no `/{tenant}/discovery/v2.0/keys`,
  no OIDC UserInfo, no PKCE enforcement, and signs with `alg: none`
  (`src/core.ts`). Its Bot Framework side (`src/botFramework.ts`) is a real RS256
  signer with a published JWKS and is the template for completing it.
- **`shared/services/email/microsoftGraphEndpoints.ts` still honours
  `MICROSOFT_LOGIN_BASE_URL` / `MICROSOFT_GRAPH_BASE_URL` unconditionally, in
  production.** Deliberately unchanged: `docker-compose.ee.yaml` runs
  `NODE_ENV: production` (lines 190, 215) while the e2e-emulators overlay sets
  that variable, so the Teams-style `NODE_ENV !== 'production'` gate would break
  the e2e emulator lane. Closing it needs an opt-in flag threaded into the
  compose overlay as well — a cross-lane change that cannot be validated without
  running the full Docker e2e stack. No sovereign-cloud support
  (`microsoftonline.us` / `.cn`) exists in the repo, so that is not a blocker.
- **Any new authority env var must be added to `GUARDED_ENV_VARS`**
  (`server/src/test/setup.ts`) or `microsoftEndpointEnvLeak.contract.test.ts`
  fails. No new variable was introduced this round.
