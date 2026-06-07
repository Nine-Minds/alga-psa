# PRD — AlgaPSA MCP Server: MVP Release Readiness

**Date:** 2026-06-07 · **Branch:** `feature/alga-mcp-server`
**Builds on:** `docs/plans/2026-06-06-alga-mcp-server/` (design.md §10 + SCRATCHPAD) — Phase 1 (local connector) and Phase 2 (remote EE governance) are **already built and live-verified**.

## Problem statement & value

The MCP server is functionally complete through Phase 2 and proven end-to-end against a live EE instance (IdP-delegated agent auth, RBAC dispatch, audit — incl. negative cases). This plan closes the **release-readiness gap** so it can ship as the MVP:

1. The EE governance code currently lives in the **CE `server/` tree** (only runtime-gated) — it must move into `ee/` so EE source doesn't ship in the open-core CE bundle.
2. It was verified on the **dev server with a mock IdP** — we need a production EE build and one **real IdP** round-trip.
3. Provisioning (trusted IdP, agents, roles, audit) is **API-only** — the user journey has no admin UI. This is the headline UX gap.
4. The free connector isn't **published**; dev test artifacts exist; admin **docs** are missing.

## Goals

- Clean CE/EE source boundary: EE MCP governance in `ee/` via the established `@product/*` seam; CE keeps only the connector, the shared engine, and the registry endpoint.
- A production **EE build** that compiles, and a **CE build** that stubs the EE surface (no leakage).
- One **real IdP** (Entra/Keycloak/Google) validated end-to-end.
- The connector **published** and `npx`-installable.
- An **admin provisioning UI** that closes the user-journey gap (register IdP, provision agents + roles, view/export audit).
- **Admin + connector setup docs**; dev artifacts removed.

## Non-goals (Phase 3 — note only)

ABAC policy for agents, approval gates (human-in-the-loop), quotas/rate-limits, in-process kernel dispatch (vs the current self-HTTP), and a full agent-lifecycle UX beyond MVP provisioning. These are explicitly **out of scope**.

## Target users / personas

- **MSP admin** — uses the new provisioning UI to register the tenant IdP, create agents, assign RBAC roles, and review the audit trail.
- **End user** — installs the free local connector.
- **External AI agent** — authenticates via the tenant IdP and operates within its assigned roles.

## Primary flows

1. **Relocation (engineering):** EE modules → `ee/server/src/lib/mcp/`; a new `@product/mcp` package (oss stub + ee entry); route shells in `server/src/app` dynamic-import the seam and 404/stub in CE; agent migrations → `ee/server/migrations` (run via `run-ee-migrations.js`). Re-run the live E2E for parity.
2. **Admin provisioning (UI — the gap):** MCP settings → add trusted IdP → create agent (name + IdP issuer/subject) → assign RBAC roles → (later) the agent connects → admin reviews/export audit.
3. **End-user activation:** create API key → configure MCP client with `npx @alga-psa/mcp-connector` → use.

## Data model / integration notes

- Existing endpoints (built): `POST /api/mcp` (JSON-RPC), `GET /.well-known/oauth-protected-resource` (PRM), `/api/v1/mcp/{agents,idp-providers,audit}`, `GET /api/v1/meta/mcp-registry`.
- Tables (built): `agents`, `agent_idp_providers`, `agent_roles`, `mcp_agent_audit`, `api_keys.agent_id`. **No RLS** (app-level tenant isolation).
- Seam pattern to mirror: `@product/chat` (`packages/product-chat` oss/ee entries + `next.config` aliasing + `await import('@product/chat/entry')`).
- Admin UI builds on existing settings UI patterns + RBAC permission gating; wires to the `/api/v1/mcp/*` endpoints (or server actions).

## Risks & mitigations

- **Relocation regressions** — moving EE modules + the seam could break the working `/api/mcp`. Mitigation: re-run the full live agent E2E (positive + 2 negatives + audit) after the move; parity is the gate.
- **Migration dir move** — the agent migrations are already applied to dev DB from `server/migrations`; moving the files to `ee/server/migrations` must not double-apply. Mitigation: same filenames remain recorded in `knex_migrations`; verify `run-ee-migrations.js` treats them as applied.
- **Real-IdP variance** — Entra/Keycloak/Google differ on subject/`azp`/`client_id` claims, audience, key rotation, clock skew. Mitigation: make the subject claim configurable; test one provider fully for MVP, document the rest.
- **Per-tenant PRM** — instance-wide issuer list leaks across tenants on SaaS. Mitigation: implement tenant-scoped PRM, or document the single-tenant-appliance limitation for MVP.

## Acceptance criteria / DoD

- No EE MCP source in a CE build; EE routes stub/404 in CE; `build:ee` compiles; live agent E2E passes post-relocation.
- One real IdP completes the full round-trip (token → dispatch → audit).
- An admin can, **entirely from the UI**, register an IdP, create an agent with roles, and view/export its audit — no curl.
- Connector is `npx`-installable from npm; dev artifacts removed; admin + connector docs published.

## Testing (80/20)

Favor **live/E2E over mocked units** (per saved feedback): the post-relocation live agent E2E, the CE-stub check, the real-IdP smoke, one connector install, and the UI provision-an-agent happy path are the high-value tests. Keep the list lean.
