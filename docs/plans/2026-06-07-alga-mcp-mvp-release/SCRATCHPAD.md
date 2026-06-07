# SCRATCHPAD — MCP MVP Release Readiness

> Closes the release gap after Phase 1 + Phase 2 (both built & live-verified).
> Prior plan + design: `docs/plans/2026-06-06-alga-mcp-server/` (design.md §10, SCRATCHPAD).

## Current state (what's already built & where)

**CE (correct, keep):**
- `packages/agent-tooling` — registry schema + ranked search + request-building + 3 meta-tool defs.
- `packages/alga-mcp-connector` — local stdio connector (npx).
- `server/src/app/api/v1/meta/mcp-registry/route.ts` + `server/src/lib/mcp/loadRegistry.ts` + `registry.generated.ts` — serves the registry to the connector.

**EE governance — currently MISPLACED in CE `server/` tree (this plan moves it):**
- `server/src/lib/mcp/{agents,idpToken,agentAudit,adminAuth,jsonRpcServer}.ts`
- `server/src/app/api/mcp/route.ts`, `server/src/app/api/v1/mcp/{agents,idp-providers,audit}/route.ts`, `server/src/app/.well-known/oauth-protected-resource/route.ts`  (all `isEnterpriseEdition()`-gated → 404 in CE)
- `server/migrations/20260607120000_create_mcp_agents.cjs`, `20260607130000_create_mcp_agent_audit.cjs`  → should be `ee/server/migrations`

**Tables (built, no RLS — app-level isolation):** `agents`, `agent_idp_providers`, `agent_roles`, `mcp_agent_audit`, `api_keys.agent_id`.

## Key references / patterns

- **Seam to mirror:** `packages/product-chat` (oss/entry.tsx stub + ee/entry.tsx real) → routes `await import('@product/chat/entry')`; `next.config.mjs` aliases `@product/chat/entry` to oss vs ee per edition (search `pkgChatEntry` ~L649). Build a parallel `@product/mcp`.
- **EE alias `@ee/`** → `ee/server/src` (used by product-chat/ee/entry).
- **Migrations:** `server/scripts/run-ee-migrations.js` merges CE (`server/migrations`) + EE (`ee/server/migrations`) into one dir under server/ and runs knex. EE-specific tables belong in `ee/server/migrations`.
- **Live test harness (from Phase 2):** mock IdP = RS256 keypair + a local JWKS HTTP server; register trusted IdP via `POST /api/v1/mcp/idp-providers`; provision agent via `POST /api/v1/mcp/agents`; sign JWT (iss/sub/aud=resource); drive `POST /api/mcp` with `Bearer`. Admin key minting + dev DB access: see `project-mcp-local-testing` memory.
- Dev server: `PORT=3001 npm run dev` (nx), `NEXT_PUBLIC_EDITION=enterprise`. next.config changes need a restart.

## Decisions

- **Relocation is the #1 release blocker** — EE source must not ship in the open-core CE bundle. Route shells stay in `server/src/app` (Next requires it) but dynamic-import EE impl via `@product/mcp`; CE gets the stub.
- **Admin provisioning UI** is the headline user-journey gap (today: API-only). In scope for MVP.
- **Phase 3 explicitly out:** ABAC policy, approval gates, quotas, in-process dispatch.
- **Testing 80/20:** the post-relocation live E2E + CE-stub check + real-IdP smoke + connector install + UI happy-path are the high-value tests; favor live over mocked units.

## IMPLEMENTATION STATUS (2026-06-07) — 22/27 features

**Done + verified live (committed):**
- **EE relocation (F001-F009)** → `ee/server/src/lib/mcp/*` behind a `@product/mcp` seam; route shells dynamic-import it; migrations in `ee/server/migrations`; next.config aliases mirror `@product/chat`. Parity E2E passed through the seam (agent dispatch + RBAC deny + untrusted-issuer + audit).
- **Polish (F012/F026/F027)** → configurable IdP subject claim (verified with an `azp` token), expired session-key sweep (5→0), audit allow/deny/error granularity.
- **Admin UI (F019-F024)** → MCP Server settings tab (EE-gated) + session-admin auth + roles endpoint. **Click-through verified in-browser**: logged in as admin → created a trusted IdP + provisioned an agent with a role, persisted to DB.
- **Docs (F017/F018/F025)** → `docs/mcp-server.md` (admin journey, auth model, limitations incl. instance-wide PRM).
- **F016** → all MCP test artifacts purged (agents/idps/backing-users/test-keys = 0).

**Remaining (5) — all external / release-gate, NOT implementable in this dev session:**
- **F010/F011** production EE+CE builds — heavy CI. Relocation is turbopack-dev-verified; CE/EE seam mirrors the working `@product/chat`. Run `npm run build:ee` + `npm run build:ce` in CI.
- **F013** real-IdP smoke — needs a real Entra/Keycloak/Google tenant (mock-IdP fully verified incl. custom `azp` claim).
- **F014/F015** publish `@alga-psa/mcp-connector` to npm — needs registry credentials + an explicit publish decision.

**Browser-login note:** automating the React-controlled signin form requires setting `input.value` via the native setter + dispatching `input`/`change` events (plain typing leaves React state empty → "Failed"). The dev admin (glinda) password rotates per server start.

## Gotchas

- Moving migration files must NOT double-apply — same filenames stay recorded in `knex_migrations` (already applied to dev DB). Verify run-ee-migrations treats them as done.
- Real IdPs vary on the agent subject claim (`sub` vs `azp` vs `client_id`), audience, and key rotation → make the subject claim configurable per provider (F012).
- PRM currently lists ALL issuers across tenants (instance-wide) — fine for single-tenant appliance; multi-tenant SaaS needs per-tenant PRM (F025).
- Agent session keys (5-min) accumulate in `api_keys` — add a cleanup sweep (F026).
- Dev artifacts to remove before release: `mcp-test-key` api_key + `mcp-agent-*@agents.alga.local` users/agents (F016).
