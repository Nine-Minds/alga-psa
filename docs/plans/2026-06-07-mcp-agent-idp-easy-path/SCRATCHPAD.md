# SCRATCHPAD — MCP Agent IdP Easy Path

> Removes the raw issuer/JWKS friction from Phase-2 agent IdP setup by mirroring Alga's
> Google/Microsoft SSO ergonomics. Source of truth = PRD.md.

## What already exists (Phase 2 — build on it, don't rebuild)

- **Token validation:** `ee/server/src/lib/mcp/idpToken.ts` (jose `createRemoteJWKSet` + `jwtVerify`, iss/aud/JWKS, maps subject claim -> agent). Cached JWKS per `jwks_uri`.
- **Provisioning:** `ee/server/src/lib/mcp/agents.ts` — `addTrustedIdp({issuer,jwksUri,audience,subjectClaim})`, `agent_idp_providers` table (issuer/jwks_uri/audience/subject_claim, no RLS).
- **Routes (seam):** `/api/v1/mcp/idp-providers` + `@product/mcp` (oss/ee). Admin UI: `server/src/components/settings/mcp/McpServerSettings.tsx` (IdP form). Session-admin auth via `adminAuth.ts`.
- **PRM:** `server/src/app/.well-known/oauth-protected-resource/route.ts` -> `listAllActiveIssuers()`.

## SSO findings (the model we're copying)

- Shared apps: `getAppSecret('GOOGLE_OAUTH_CLIENT_ID'/'..._SECRET')`, `MICROSOFT_OAUTH_CLIENT_ID/SECRET` (`packages/auth/src/lib/nextAuthOptions.ts:1053-1073`). `secrets/google_oauth_client_id` present.
- Entra multi-tenant: `issuer: https://login.microsoftonline.com/${microsoftTenantId || 'common'}/v2.0` (`nextAuthOptions.ts:1088,1136,1165`). `tid` claim = customer tenant.
- Enterprise override: own creds + domain claim (`msp_sso_tenant_login_domains`), discovery by email domain (`packages/auth/src/lib/sso/mspSsoResolution.ts`).
- Existing Entra plumbing to reuse: `microsoft_profiles`, `microsoft_profile_consumer_bindings`, `entra_managed_tenants` / `entra_client_tenant_mappings` (migration `20260220143000_create_entra_phase1_schema.cjs`).
- No generic OIDC discovery yet (only QuickBooks/Intuit). We add a tiny one.

## Decisions

- **Tiered, not one-size.** Interactive/human-delegated agents -> Tier 2 hosted zero-config. Unattended machine agents -> Tier 1 presets + reuse + wizard (their directory identity is irreducible).
- **`subject_claim` per provider, editable.** Microsoft app tokens use `azp`/`appid`; user tokens use `oid`/`sub`. Google service-account `sub`. Default per preset, surface inline guidance — do NOT hardcode.
- **Still delegating** (no Alga AS). Built-in hosted issuers are just *pre-trusted* Google/Microsoft, validated the same way as `agent_idp_providers`.
- **`kind` column** keeps custom raw-entry working unchanged (Phase-2 parity).

## Provider facts (for the presets module)

- **Google:** issuer `https://accounts.google.com`; discovery `https://accounts.google.com/.well-known/openid-configuration`; JWKS `https://www.googleapis.com/oauth2/v3/certs`. Service-account identity = `sub` (numeric) / `email`.
- **Microsoft v2.0:** issuer `https://login.microsoftonline.com/{tid}/v2.0`; discovery `…/{tid}/v2.0/.well-known/openid-configuration`; JWKS from discovery. App-only token claims: `azp`/`appid` = the app registration's client id; `oid` = service principal object id. (`tid` is the customer Entra tenant.)

## Implementation log

- **Tier 1 (F001–F007) shipped:** `idpPresets.ts` (resolveIdpFromPreset google/microsoft/custom) + `oidcDiscovery.ts` (cached well-known fetch). `addTrustedIdp` resolves presets; route+seam pass `kind`/`entraTenantId`. Admin UI dropdown + conditional fields + resolved row in the providers table. Verified live vs real Google/Microsoft discovery docs.
- **Reuse (F008–F009) shipped:** `getIdpSuggestions(tenant)` reads `microsoft_profiles` (is_archived=false, prefer is_default) -> `{microsoft:{entraTenantId,…}}`; `/api/v1/mcp/idp-suggestions`; UI banner (`#mcp-ms-suggestion`, `#mcp-use-ms-connection`) one-click prefills the Microsoft preset. Verified in-browser.
- **Tier 2 (F010–F014) shipped:** `idpBuiltins.ts` — `hostedGoogleEnabled()`/`hostedMicrosoftEnabled()` (appSecret GOOGLE/MICROSOFT_OAUTH_CLIENT_ID), `getBuiltinIdpForIssuer(issuer)` (Google fixed issuer; MS regex `…/{tid}/v2.0`), `listBuiltinIssuers()`.
  - `idpToken.authenticateAgentToken` now builds a unified candidate list: `agent_idp_providers` rows **+** the built-in for the issuer. Built-ins carry `tenant: null` -> tenant-match check is skipped (agent tenant comes solely from the (issuer, subject) binding).
  - `agents.listAllActiveIssuers` merges `listBuiltinIssuers()` (deduped) for PRM.
  - **Verified live:** dev has `secrets/google_oauth_client_id` only (no MS). `GET /.well-known/oauth-protected-resource` now returns `authorization_servers: ["https://accounts.google.com"]` with **zero** `agent_idp_providers` rows -> the Google built-in is advertised purely from the shared-app secret. F014: agent provisioning form already accepts free-form `idpIssuer`/`idpSubject`, so binding to the built-in `accounts.google.com` issuer needs no IdP row.
  - Nice-to-have (deferred): surface built-in issuers as preset choices in the *agent* form too (today the admin types `https://accounts.google.com`).

- **F016 (dup-binding) shipped:** `AgentBindingConflictError` in agents.ts; `createAgent` pre-checks `resolveAgentByIdp(issuer, subject)` and throws a friendly message; the agents POST route maps `.name === 'AgentBindingConflictError'` -> HTTP 409 (string-name match because the seam erases class identity). **Verified live:** first create 201, second (same issuer/subject) 409 with the message; test agent + backing user cleaned up.
- **F018 (docs) shipped:** `docs/mcp-server.md` now documents the easy path (presets / reuse / hosted built-ins) and the irreducible interactive-vs-unattended distinction (unattended machine agents still need their own Entra app registration / Google service account).
- **F017 deferred:** the copy-paste directory-identity wizard (guided Entra/Google service-account setup) is its own follow-up UI piece — the docs cover the steps in prose for now.

## Infra (supporting)

- `server/scripts/run-ee-migrations.js` rewritten to merge CE+EE migrations into a dir **under server/** (was os.tmpdir()) so migrations' relative `require`/`path.resolve(__dirname,'..')` resolve (node_modules + src siblings). Auto-cleaned in `finally`; `EE_MIGRATIONS_KEEP_TMP=1` to retain. `.gitignore`: `.ee-combined-migrations-*/`.

## Gotchas

- OIDC discovery is a network call -> cache it; fail with a clear message; let `custom` override the `jwks_uri`.
- Microsoft `common` issuer doesn't match per-tenant token `iss` (tokens are issued with the concrete `tid`). For agents, prefer the **concrete tenant id**, not `common`, so `jwtVerify({issuer})` matches.
- Hosted built-ins must be gated to SaaS + only when shared secrets exist; bind agents per `(issuer, subject)` to stay attributable.
- Reuse the Phase-2 mock-IdP E2E harness for T005 (RS256 keypair + local JWKS + a mock `.well-known/openid-configuration` so the preset/discovery path is exercised end-to-end).
