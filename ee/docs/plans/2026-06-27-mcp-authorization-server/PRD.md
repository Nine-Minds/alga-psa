# PRD — Alga as MCP Authorization Server

- Slug: `2026-06-27-mcp-authorization-server`
- Date: `2026-06-27`
- Status: Draft (pending review)

## Summary

Make AlgaPSA its own **OAuth 2.1 Authorization Server (AS)** for the remote MCP
server (`POST /api/mcp`), so an MCP client such as claude.ai can connect with no
hand-configuration. Today AlgaPSA is only a *resource server* and its Protected
Resource Metadata points clients straight at the raw tenant IdPs (Entra/Google);
those don't support automatic client registration, can't mint tokens audience-bound
to the MCP resource, and (Google) can't produce verifiable JWTs at all — so the
claude.ai connector dead-ends at *"Automatic client registration isn't supported…
add an OAuth Client ID."*

Because the connecting parties are **humans who are already users of tenants hosted
on algapsa.com**, AlgaPSA is already their identity system. The AS therefore reuses
the user's existing AlgaPSA login session, issues a short-lived AlgaPSA-signed access
token that **represents that user** (their tenant + their RBAC/ABAC), and the MCP
server dispatches tool calls under the user's own permissions — exactly like the
free local connector, but over OAuth instead of a pasted API key.

## Problem

1. **No automatic client registration.** claude.ai (per the MCP authorization spec)
   tries DCR against the advertised authorization server; the raw IdPs reject it.
2. **No audience/resource path.** claude.ai requests a token bound to the MCP
   resource (RFC 8707). Entra requires the MCP server registered as an API; Google
   can't issue a verifiable, custom-audience JWT at all.
3. **Provisioning friction.** Even past auth, today's model 403s ("no active agent")
   until an admin hand-provisions an agent bound to the exact `(issuer, subject)`
   the token carries.

Net: connecting a hosted AlgaPSA user's Claude to their own data is effectively
impossible without bespoke per-IdP OAuth plumbing. See `docs/mcp-server.md`
("Known MVP limitations") and this plan's `SCRATCHPAD.md` for the full trace.

## Goals

- A hosted AlgaPSA user can add AlgaPSA as a custom connector in claude.ai and
  complete OAuth with **no manual Client ID** and **no admin provisioning step**.
- AlgaPSA serves standards-compliant AS discovery + endpoints: AS Metadata
  (RFC 8414), authorization-code + **PKCE/S256**, refresh tokens, token revocation,
  and a client-registration mechanism (see decisions).
- The issued token **represents the authenticated AlgaPSA user**; MCP tool calls
  run under that user's existing RBAC/ABAC and are audited.
- The existing direct-IdP / governed-agent path keeps working unchanged
  (backward compatible) for self-hosted appliances and unattended machine agents.

## Non-goals

- **No governed "agent" identity for the interactive path** (Option B). The
  hosted interactive connection is the user themselves. (May revisit; not now.)
- **No general identity-federation / IdP-broker product.** We are not building a
  multi-IdP federation layer; AlgaPSA simply uses its own existing login.
- **No client-credentials / machine-token issuance at AlgaPSA's AS in v1.**
  Unattended agents continue using the existing direct-IdP delegation model.
- **No Dynamic Client Registration (DCR) in v1.** Client identification is CIMD
  only; DCR is a possible fast-follow if a required MCP client lacks CIMD support.
- **No replacement of the local stdio connector** (CE) — unchanged.
- No new per-tenant PRM/host-routing scheme; the AS is instance-wide and resolves
  tenant from the authenticated session (see Open Questions).

## Users and Primary Flows

**Persona:** a logged-in AlgaPSA user (e.g. an MSP technician) who wants to use
Claude against their own AlgaPSA tenant.

**Primary flow — connect claude.ai (happy path):**
1. User adds `https://algapsa.com/api/mcp` as a custom connector in claude.ai.
2. claude.ai `POST /api/mcp` → `401` + `WWW-Authenticate` → reads PRM →
   sees `authorization_servers: ["https://algapsa.com"]`.
3. claude.ai fetches `/.well-known/oauth-authorization-server` and uses **CIMD**
   (its hosted client-metadata URL as `client_id` — no human step, no registration
   call), then starts auth-code + PKCE.
4. AlgaPSA `/authorize`: if the user has an AlgaPSA session, show a consent screen
   ("Claude wants to access AlgaPSA as you in <tenant>"); if not, run normal
   AlgaPSA login first. On approve → redirect back with an auth code.
5. claude.ai exchanges code (+ PKCE verifier) at `/token` → AlgaPSA-signed access
   token (short-lived) + refresh token.
6. claude.ai calls `POST /api/mcp` with the bearer token → MCP server validates the
   AlgaPSA token, resolves user + tenant, dispatches tools under the user's RBAC.

**Secondary flows:** token refresh; user/admin revokes a connected client
(disconnect); unattended machine agent (unchanged existing path).

## UX / UI Notes

- **Consent screen** (new, minimal): client name, the tenant, the access being
  granted ("act in AlgaPSA as you"), Approve / Deny. Trust-on-first-use, remembered
  per `(user, client)`.
- **Connected MCP clients** (Settings → MCP, additive): list of clients a user has
  authorized, with revoke. Reuse existing MCP settings surface; keep the existing
  agent/trusted-IdP admin sections for the backward-compat path.
- Reuse existing AlgaPSA login UI for the unauthenticated `/authorize` case.

## Requirements

### Functional Requirements

- **AS discovery:** `/.well-known/oauth-authorization-server` (RFC 8414) advertising
  issuer, `authorization_endpoint`, `token_endpoint`, `jwks_uri`, `response_types`,
  `grant_types`, `code_challenge_methods=[S256]`, `scopes_supported`. No
  `registration_endpoint` (CIMD only).
- **PRM update:** `/.well-known/oauth-protected-resource` advertises
  `authorization_servers: ["https://<base>"]` (AlgaPSA itself) and a non-empty
  `scopes_supported`.
- **/authorize:** auth-code flow, **PKCE/S256 required**, `state` + redirect_uri
  validation against the registered/declared client, resource indicator (RFC 8707)
  accepted and bound into the token audience; reuses AlgaPSA session, else login;
  consent.
- **/token:** authorization_code (PKCE verify) + refresh_token grants; issues
  AlgaPSA-signed JWT access token (aud = `https://<base>/api/mcp`, short TTL) and a
  rotating refresh token.
- **JWKS:** AlgaPSA publishes signing keys; supports key rotation.
- **Client registration:** **CIMD only** (Client ID Metadata Documents). The
  `client_id` is an https URL; Alga fetches + validates that metadata document
  (incl. redirect_uris) at authorize time. No `/register` (DCR) endpoint in v1.
- **Token validation at the MCP RS:** `jsonRpcServer.ts` accepts AlgaPSA-issued
  tokens (verify iss/aud/sig/exp + revocation), resolves the **user + tenant**, and
  dispatches under the user's identity/RBAC. **Also still accepts** existing
  external-IdP agent tokens (backward compat).
- **Revocation / disconnect:** revoke a grant (single client or all) → access +
  refresh stop working; surfaced in Settings.
- **EE-gated** like the rest of the remote MCP server; instance-wide AS endpoints
  with tenant derived from the authenticated session.

### Non-functional Requirements

- Standards-compliant enough for claude.ai's connector and at least one other MCP
  client to connect unattended.
- Short access-token TTL (≈ minutes) with refresh; secrets/keys via the existing
  secret provider; CIMD fetch (if built) is https-only, validated, timed-out.
- Reuse existing dispatch + audit infrastructure; no new observability stack.

## Data / API / Integrations

- **New tables (likely):** `mcp_oauth_clients` (CIMD-derived client records),
  `mcp_oauth_grants` (auth codes, refresh tokens, consent, revocation), keyed by
  tenant/user. (Final shape during design.)
- **Signing keys** for AlgaPSA-issued JWTs (new) + JWKS endpoint.
- **Reuse:** `resolvePublicBaseUrl` (issuer/base), `@product/mcp` seam, MCP dispatch
  + audit, existing AlgaPSA NextAuth session/login, secret provider.
- **Endpoints (new, EE):** `/.well-known/oauth-authorization-server`, `/oauth/authorize`,
  `/oauth/token`, `/.well-known/jwks.json`, `/oauth/revoke`. (No `/oauth/register` —
  CIMD only. Exact paths TBD; must match AS metadata.)

## Security / Permissions

- The token represents the user → tool calls are bound by the user's existing
  RBAC/ABAC (no privilege escalation beyond what the user already has).
- PKCE/S256 mandatory; strict redirect_uri matching; signed/expiring auth codes;
  refresh-token rotation + revocation; consent recorded.
- CIMD metadata fetch needs SSRF protection (https-only, host validation, timeout,
  size cap, cached). No open registration write endpoint exists (CIMD only), which
  removes the DCR abuse surface entirely.
- Auth code / token issuance audited; tool calls audited via existing trail.

## Rollout / Migration

- Additive + behind EE + (optionally) the existing `mcp-server` feature flag for a
  dark release.
- PRM flips to advertise AlgaPSA-as-AS; RS continues to accept legacy external-IdP
  agent tokens, so existing appliance/machine-agent setups are unaffected (no data
  migration required for them).
- Deploy note: claude.ai redirect URI is fixed (`https://claude.ai/api/mcp/auth_callback`)
  — validated by AlgaPSA, not whitelisted in an external IdP, so no per-IdP config.

## Decisions (resolved with product owner, 2026-06-27)

- **Client registration: CIMD only** in v1 (no DCR). DCR is a possible fast-follow.
- **Multi-tenant: not a concern** — a user belongs to exactly one tenant, so the
  AS resolves tenant unambiguously from the logged-in session. No tenant picker, no
  tenant-hinted PRM.
- **Connected-clients management view is in v1** (list + disconnect).

## Open Questions

- **Consent scope granularity:** v1 uses a single coarse "act in AlgaPSA as you"
  scope (actual authorization is the user's RBAC at dispatch time); revisit only if
  finer-grained scopes are needed later.
- Exact endpoint paths, token TTLs, and table column shapes — finalized during
  technical design.

## Acceptance Criteria (Definition of Done)

- From a clean claude.ai workspace, a hosted AlgaPSA user adds the connector and
  completes OAuth **without** entering a Client ID or any admin provisioning, and
  can successfully call the 3 MCP tools scoped to **their** permissions/tenant.
- `/.well-known/oauth-authorization-server` + `/.well-known/oauth-protected-resource`
  are standards-valid and consistent; PKCE/S256 enforced; resource-bound audience.
- Refresh works; revocation/disconnect immediately invalidates access.
- Existing external-IdP agent tokens still authenticate and dispatch (regression-safe).
- A second CIMD-capable MCP client (or a scripted CIMD client) completes the same flow.
