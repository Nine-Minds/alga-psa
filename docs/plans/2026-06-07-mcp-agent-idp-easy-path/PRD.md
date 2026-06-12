# PRD — MCP Agent IdP "Easy Path" (Google / Microsoft presets)

**Date:** 2026-06-07 · **Branch:** `feature/alga-mcp-server`
**Builds on:** Phase-2 IdP delegation (`docs/plans/2026-06-06-alga-mcp-server/design.md §10`) + the MVP admin UI (`docs/plans/2026-06-07-alga-mcp-mvp-release/`).

## Problem statement & value

The remote MCP server authenticates agents by **delegating to the tenant's IdP** (it validates JWTs via JWKS and maps a subject claim to a provisioned agent). It works, but setup is **raw and technical**: an admin must hand-enter the `issuer`, `jwks_uri`, `audience`, and `subject_claim`. Alga's **SSO** already solves the equivalent problem elegantly — Nine Minds runs **shared Google + multi-tenant Entra apps**, so hosted customers get "Sign in with Google/Microsoft" with near-zero config, and enterprises can bring their own. This plan brings that same **"pick Google or Microsoft and go"** ergonomics to MCP agent auth.

## Goals

- **Provider presets**: choose **Microsoft Entra** or **Google** (instead of raw issuer/JWKS). Auto-derive `issuer` and discover `jwks_uri` via OIDC discovery. Google needs nothing; Microsoft needs only the Entra tenant id.
- **Reuse existing connections**: if the tenant already connected Microsoft (SSO / `microsoft_profiles` / `entra_managed_tenants`), pre-fill the agent IdP — *"you're already connected to Microsoft, enable agent access?"*.
- **Hosted near-zero-config (Tier 2)**: on SaaS, pre-trust Google + Microsoft via the **Nine Minds shared apps**; the MCP client's interactive `auth-code+PKCE` flows through them, so the customer configures nothing in their own directory.
- **Honest guidance** for the case the SSO analogy can't fully cover (below).

## Non-goals

- Alga acting as its **own OAuth authorization server** (we delegate — decided in §10).
- Changing the **core agent dispatch / RBAC / audit** (already built + verified).
- SAML; per-agent ABAC/approval/quotas (Phase 3).

## The key distinction (why this is tiered, not one-size)

SSO is **human** login; the shared app is just the OAuth client and the user's identity (`tid`/email) rides in the token. Agents are **governed machine principals**, so two cases differ:

- **Interactive / human-delegated agents** (the MCP spec's `auth-code+PKCE` — a human authorizes the MCP client in a browser): **fully "like SSO"** → Tier 2 zero-config on hosted.
- **Unattended machine agents** (no human, `client-credentials`): the agent needs **its own identity in the customer's directory** (an Entra **app registration** / a Google **service account**). This step is **irreducible** — the shared app can't *be* the customer's agent. Presets + discovery + connection-reuse make it easy, and a guided wizard gives copy-paste values, but it can't be zero-config like human SSO.

## Target users / personas

- **MSP admin (hosted)** — wants to enable agent access by picking Microsoft/Google, ideally reusing an existing connection.
- **MSP admin (self-hosted/enterprise)** — brings their own Entra tenant / Google project; presets + discovery still remove the manual JWKS step.

## Primary flows

1. **Microsoft preset:** MCP Server settings → "Add trusted IdP" → choose **Microsoft Entra** → enter (or auto-fill from an existing connection) the **Entra tenant id** → Alga derives `issuer = https://login.microsoftonline.com/{tid}/v2.0` and discovers `jwks_uri` → save. Provision an agent; its **subject** = the agent's Entra app id (`azp`/`appid`) for app tokens, or `oid`/`sub` for user tokens.
2. **Google preset:** choose **Google** → nothing to enter (issuer `https://accounts.google.com`, well-known JWKS). Agent subject = the service account's `sub` (or email).
3. **Hosted zero-config:** the tenant doesn't register anything; built-in Google/Microsoft issuers (shared app) are trusted; the agent connects via interactive OAuth and binds to the authorizing identity.
4. **Custom (unchanged):** raw issuer/jwks/audience/claim still available.

## Data model / integration notes

- `agent_idp_providers` gains `kind` (`google`|`microsoft`|`custom`, default `custom`) and `entra_tenant_id` (nullable). Existing rows = `custom`.
- **OIDC discovery helper** (new, ~30 lines, reuses `jose`/`fetch`): `discover(issuerOrConfigUrl) → { issuer, jwks_uri }`, cached.
- **Presets module**: Google = fixed issuer + well-known JWKS, default `subject_claim='sub'`; Microsoft = issuer from tenant id, discover JWKS, default `subject_claim='azp'` (app tokens) with a user-token hint (`oid`).
- **Connection reuse**: read `microsoft_profiles` / `entra_managed_tenants` / known `tid` to suggest the Entra tenant id.
- **Hosted built-ins**: `getAppSecret('MICROSOFT_OAUTH_CLIENT_ID')` / `GOOGLE_OAUTH_CLIENT_ID` present + a hosted flag → built-in trusted issuers (validated in `idpToken` alongside `agent_idp_providers`); PRM advertises them.
- Validation lives in `ee/server/src/lib/mcp/idpToken.ts` (jose); provisioning in `agents.ts`; admin UI in `server/src/components/settings/mcp/McpServerSettings.tsx`; routes under `/api/v1/mcp/*`.

## Risks & mitigations

- **OIDC discovery network dependency** — cache discovery results; fail with a clear message; allow manual `jwks_uri` override (custom).
- **Microsoft subject-claim ambiguity** (`azp`/`appid` for app tokens vs `oid`/`sub` for user tokens) — make `subject_claim` an explicit, preset-defaulted, editable field with inline guidance.
- **Hosted shared-app trust** — only enable built-in issuers when hosted + shared secrets present; bind agents per `(issuer, subject)` to keep them distinct/attributable.
- **Over-promising zero-config** — the UI + docs must be explicit that unattended machine agents still need their own directory identity.

## Acceptance criteria / DoD

- An admin can add a working trusted IdP by picking **Microsoft** (just a tenant id) or **Google** (nothing) — issuer + JWKS auto-resolved; an agent then authenticates against it (verified with a mock IdP whose discovery doc the preset path consumes).
- A tenant with an existing Microsoft connection sees a **pre-filled** suggestion.
- On a hosted build, Google + Microsoft are trusted with **no** per-tenant IdP registration, and PRM advertises them.
- `custom` raw entry still works. Docs spell out the easy path **and** the unattended-agent caveat.

## Testing (80/20)

Favor **live/E2E over mocked units**: OIDC discovery against the **real** Google + Microsoft well-known docs, a mock-IdP **preset** round-trip (register via the Microsoft preset pointed at a mock discovery doc → agent token validates + dispatches), and the admin-UI preset happy path. Keep the list lean.
