# SCRATCHPAD — Alga as MCP Authorization Server

Rolling working memory. Append discoveries/decisions/gotchas as they happen.

## Post-merge fixes (2026-06-28)

Live testing of claude.ai after #2803 merged still hit the DCR error. Diagnosis:
- #2803 IS deployed (the AS route returns my JSON 404, not Next's HTML 404), but
  it was gated off — and live `sebastian-blue` (active color; green idle) is
  **Helm-managed**, so a manual `kubectl set env` would be reverted and wouldn't
  help anyway (CIMD signal is compiled in). No deploy-free path exists.
- **Real gap (PR #2804):** Claude only uses CIMD when the AS metadata advertises
  BOTH `client_id_metadata_document_supported: true` AND `none` in
  `token_endpoint_auth_methods_supported`. We had only the latter → Claude fell
  back to DCR → no registration_endpoint → the error. Added the missing flag.
- **F040 reversed per product owner:** the `MCP_AUTH_SERVER_ENABLED` dark-release
  gate is **removed** — the AS is always on for EE (no flag to set). Deleted
  `oauth/config.ts`, the seam export, and the route checks; PRM always advertises
  Alga-as-AS when EE. (Trade-off: no runtime kill-switch; revert = redeploy.)

## Origin of this plan

Tracing why claude.ai's connector UI couldn't connect to the remote MCP server
(`https://algapsa.com/api/mcp`) surfaced a structural gap. Two upstream bugs were
fixed first (see "Already shipped"); the connector then failed at the OAuth step
with: *"Automatic client registration isn't supported by Alga PSA. Edit the
connector and add an OAuth Client ID."* That error is **expected** given the
current design and is the motivation for this plan.

## Current architecture (as of 2026-06-27)

- **Alga is an OAuth 2.1 Resource Server ONLY. It does not issue tokens.**
  (`docs/mcp-server.md` §"Auth model".)
- Protected Resource Metadata (RFC 9728) at
  `server/src/app/.well-known/oauth-protected-resource/route.ts` advertises the
  trusted **IdPs themselves** as `authorization_servers` (Entra tenant, Google,
  Entra `organizations`). There is **no** `/.well-known/oauth-authorization-server`.
- Token validation: `ee/server/src/lib/mcp/idpToken.ts` →
  `authenticateAgentToken()`. Verifies bearer JWT against the trusted IdP's JWKS
  (issuer + optional audience + signature via `jose`), maps the configured
  **subject claim** → provisioned agent via `resolveAgentByIdp(issuer, subject)`.
- Agents bind one-to-one to `(idp_issuer, idp_subject)`; provisioning is
  admin-authed `POST /api/v1/mcp/agents` (`ee/server/src/lib/mcp/agents.ts`,
  `createAgent`). Duplicate binding → `AgentBindingConflictError` (409).
- On a valid token, `jsonRpcServer.ts` mints a **short-lived (5 min) agent-scoped
  session key** (`mintAgentSessionKey`) and dispatches tool calls against
  `/api/v1` under that key (kernel-enforced RBAC).
- Two IdP trust tiers:
  - **Registered rows** (`agent_idp_providers`): presets in `idpPresets.ts`
    (Google → subject `sub`; Microsoft → subject `azp`, needs concrete tenant id,
    NOT `common`). `addTrustedIdp` stores `audience: input.audience ?? null` →
    **audience NOT enforced unless explicitly set.**
  - **Hosted built-ins** (`idpBuiltins.ts`): when shared SSO app secrets are
    present, Google + Microsoft issuers are pre-trusted. **Built-in audience IS
    pinned** to `GOOGLE_OAUTH_CLIENT_ID` / `MICROSOFT_OAUTH_CLIENT_ID` (the shared
    SSO app), subject `sub` (Google) / `azp` (Microsoft).
- Admin "Connect with Microsoft/Google" (`connectOAuth.ts`) is an **inert**
  interactive flow that captures `{iss, sub}` to pre-fill agent provisioning; it
  discards all tokens and creates nothing. NOT an end-user auth path for claude.ai.
- `@product/mcp` seam: CE route shells import from `@product/mcp/entry`, which
  resolves to `packages/product-mcp/{ee,oss}/entry.ts`; EE re-exports
  `@ee/lib/mcp/*`. Route shells gate on `isEnterpriseEdition()`.

## Why the claude.ai UI path fails today

1. claude.ai reads PRM → picks an `authorization_server` (a raw IdP issuer).
2. Fetches that IdP's AS metadata, attempts **DCR (RFC 7591)** to self-register.
3. Entra/Google **do not support anonymous DCR** → claude.ai asks for a manual
   Client ID.
4. Even with a manual Client ID, three OAuth realities bite:
   - IdP app must whitelist Claude's redirect URI `https://claude.ai/api/mcp/auth_callback`.
   - claude.ai (MCP spec) requests a token for the MCP **resource** (RFC 8707).
     Entra needs the MCP server exposed as an API to mint such a token; **Google
     cannot** (opaque access tokens; id_token aud = client_id). → only Entra is
     even viable under the current design.
   - The agent must be bound to whatever `(iss, sub)` the resulting token carries.

## claude.ai connector OAuth facts (verified from docs, 2026-06)

- Redirect/callback URI: `https://claude.ai/api/mcp/auth_callback`
- PKCE **required** (`code_challenge_method=S256`) on every authorize request.
- Client Secret **optional** (public client by default; supply only if AS is
  confidential).
- Requests the scopes advertised in PRM `scopes_supported` (currently `[]`).
- Registration approaches Claude supports: **DCR**, **CIMD** (Client ID Metadata
  Documents — Claude's *preferred* path for new connectors, no registration call),
  and Anthropic-held creds. Manual Client ID/Secret via connector **Advanced settings**.
- Sources: claude.com/docs/connectors/building/authentication;
  support.claude.com/en/articles/11503834; .../11175166.

## The fix (this plan)

Make **Alga itself the MCP Authorization Server**: advertise
`authorization_servers: ["https://<base>"]`, serve
`/.well-known/oauth-authorization-server` (RFC 8414), implement
`authorize` / `token` + PKCE + resource indicators with **CIMD** client
identification (no DCR in v1), and authenticate the user via **Alga's own login**
(no external IdP broker for hosted users — see Decisions). Alga
mints its own short-lived JWT access tokens audience-bound to `/api/mcp`, and maps
the authenticated identity → provisioned agent. This removes per-IdP DCR/redirect/
audience friction, makes Google work again, and gives claude.ai a clean "Connect".

## Already shipped (prerequisites, this session)

- **PR #2800 (merged):** discovery advertises public base URL (`resolvePublicBaseUrl`
  via `@product/mcp` seam) instead of internal `req.nextUrl.origin`. Fixed
  `oauth-protected-resource/route.ts` `resource` + `jsonRpcServer.ts`
  `WWW-Authenticate`.
- **CDN (applied):** added `/.well-known/*` → Managed-CachingDisabled behavior on
  CloudFront dist `E1A7WMB6KFZSJT` (was caching PRM 24h under default policy).
- **PR #2801 (in CI):** `Cache-Control: no-store` on the PRM route (portable
  in-app version of the CDN fix).

## Key file map

| Concern | Path |
|---|---|
| PRM (RFC 9728) | `server/src/app/.well-known/oauth-protected-resource/route.ts` |
| MCP RS endpoint (JSON-RPC) | `ee/server/src/lib/mcp/jsonRpcServer.ts` |
| Token validation | `ee/server/src/lib/mcp/idpToken.ts` |
| Built-in IdPs (audience pinning) | `ee/server/src/lib/mcp/idpBuiltins.ts` |
| IdP presets | `ee/server/src/lib/mcp/idpPresets.ts` |
| Agents / binding / session keys | `ee/server/src/lib/mcp/agents.ts` |
| Admin connect (inert capture) | `ee/server/src/lib/mcp/connectOAuth.ts` |
| OIDC discovery helper | `ee/server/src/lib/mcp/oidcDiscovery.ts` |
| Public base URL resolver | `ee/server/src/lib/mcp/baseUrl.ts` |
| Seam | `packages/product-mcp/{entry,ee/entry,oss/entry}.ts` |
| Design doc | `docs/mcp-server.md` |

## Decisions

- (2026-06-27) Plan lives in its own folder under `ee/docs/plans/` (4-artifact
  alga-plan format), on branch `plan/mcp-authorization-server` off `main`.
- (2026-06-27) **LOCKED — Alga is the MCP Authorization Server**, reusing Alga's
  OWN login session. Key reframing from the user: the connecting parties are humans
  who are already users of tenants hosted on algapsa.com, so Alga is already their
  identity system. There is NO external "federate down to tenant IdP" hop for the
  hosted path — `/authorize` just checks the existing Alga session (or runs normal
  Alga login). "Federation" only ever applied to the self-hosted appliance /
  machine-agent path, which we keep untouched for backward compat. We are NOT
  building a federation product.
- (2026-06-27) **LOCKED — Option A: the MCP token represents the Alga USER**, with
  their existing RBAC/ABAC. ZERO provisioning; the "no active agent → 403" friction
  disappears for this path. Same identity model as the free local connector (user's
  own permissions), upgraded from a pasted API key to OAuth. User on Option B
  (governed agent for the interactive path): "Definitely A now, maybe never B."
- (2026-06-27) **LOCKED — v1 = interactive auth-code + PKCE only.** No
  client-credentials issuance at Alga's AS in v1; unattended machine agents keep the
  existing direct-IdP delegation path.
- (2026-06-27) **LOCKED — client registration = CIMD ONLY** in v1 (no DCR
  endpoint). Removes the open-write abuse surface; DCR is a possible fast-follow.
- (2026-06-27) **LOCKED — multi-tenant is a non-issue:** a user belongs to exactly
  one tenant, so the AS resolves tenant unambiguously from the session. No tenant
  picker, no tenant-hinted PRM.
- (2026-06-27) **LOCKED — connected-clients management view is in v1** (list +
  disconnect/revoke).
- (2026-06-27) Consent: trust-on-first-use screen, single coarse "act as me via
  MCP" scope (RBAC enforced at dispatch).
- (2026-06-27) Prereq cache/origin work all merged: PR #2800 (origin), PR #2801
  (no-store, merge `43a49153`), CDN `/.well-known/*` CachingDisabled applied.

## Implementation notes (2026-06-27)

Backend complete + typechecking clean (ee/server + server). Files:
- Migration `ee/server/migrations/20260627170000_create_mcp_oauth.cjs` — 5 tables:
  signing_keys, clients, grants (consent+revocation anchor), auth_codes, refresh_tokens.
- `ee/server/src/lib/mcp/oauth/{keys,tokens,clients,grants,authServer,userSession}.ts`.
- Routes (server/src/app): `.well-known/oauth-authorization-server`,
  `.well-known/jwks.json`, `api/mcp/oauth/{authorize,token,revoke}`; PRM updated to
  advertise Alga-as-AS + scopes `['mcp']` + no-store.
- RS: `jsonRpcServer.ts` resolveAuth now has a 3rd path — Alga `at+jwt` user tokens
  (verify → grant-active check → mintUserSessionKey → dispatch as the user).
- Seam: ee/entry + oss/entry export the AS surface.

Endpoint paths: `/api/mcp/oauth/{authorize,token,revoke}`, JWKS at
`/.well-known/jwks.json`. Token TTLs: access 10m, refresh 30d, auth code 60s.

DEVIATIONS from the plan, by design:
- **F005 signing keys live in a DB table (`mcp_oauth_signing_keys`), not the secret
  provider.** The secret provider interface is read-only (`getAppSecret`), so a DB
  table is the practical home for generated, rotatable keypairs (kid + active flag).
- Tables normalized beyond "clients + grants" (added signing_keys, auth_codes,
  refresh_tokens) — standard OAuth modeling. Access tokens are stateless JWTs; the
  grant row is the revocation anchor the RS checks (F030).

Remaining: F035/F036 (connected-clients UI), F040 (feature-flag gating), tests.

## Test status (2026-06-27)

All 38 features implemented; both editions typecheck clean. Tests: 8/17 landed.

- **Unit (verified green locally, 25 assertions across 4 files):**
  - `mcpOAuthTokens.test.ts` — mint/verify, audience binding (T006), expiry,
    tamper, unknown-kid, looksLikeAlgaToken.
  - `mcpOAuthCrypto.test.ts` — PKCE S256 (T002 core) + signed auth-request integrity.
  - `mcpOAuthClients.test.ts` — SSRF guard / isPrivateAddress (T012).
  - `mcpOAuthMetadata.test.ts` — AS metadata RFC 8414 + CIMD-only (T010), param parse.
- **DB integration (CI-verified green; not runnable locally — no Postgres):**
  - `mcpOAuthGrants.integration.test.ts` — grant lifecycle: consent reuse, PKCE
    auth-code single-use + replay-revoke (T004), refresh rotation + replay (T005),
    revocation (T008), DB persistence/guards (T017). **Passed in CI** (Tier-1
    integration subset) against migrated Postgres on PR #2803.

- **Remaining (T001, T003, T007, T009, T011, T013, T014, T015, T016):** route- and
  browser-level e2e (full authorize→token→/api/mcp flow, redirect/login/consent
  paths, RBAC enforcement, legacy-agent backward compat, CIMD resolve against a
  live metadata doc, connected-clients UI, EE gate). Higher effort; deferred as a
  follow-up. The security-critical core (PKCE, audience, single-use, rotation,
  revocation, SSRF) IS covered.

## Open questions (remaining)

- Consent scope granularity (coarse for v1; revisit if finer scopes needed).
