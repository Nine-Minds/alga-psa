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

## Gotchas

- OIDC discovery is a network call -> cache it; fail with a clear message; let `custom` override the `jwks_uri`.
- Microsoft `common` issuer doesn't match per-tenant token `iss` (tokens are issued with the concrete `tid`). For agents, prefer the **concrete tenant id**, not `common`, so `jwtVerify({issuer})` matches.
- Hosted built-ins must be gated to SaaS + only when shared secrets exist; bind agents per `(issuer, subject)` to stay attributable.
- Reuse the Phase-2 mock-IdP E2E harness for T005 (RS256 keypair + local JWKS + a mock `.well-known/openid-configuration` so the preset/discovery path is exercised end-to-end).
