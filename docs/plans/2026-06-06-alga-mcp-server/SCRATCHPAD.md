# SCRATCHPAD — AlgaPSA MCP Server

> Working memory for the effort. Source of truth for scope = `design.md` in this folder.

## Context

Implement AlgaPSA as an MCP **server** in two transports: a free CE local stdio connector and an EE remote Streamable HTTP server with governance. Central design move: **progressive disclosure** — 3 constant meta-tools, not per-endpoint tools — reusing the **existing EE chat agentic engine**.

## Key discoveries (existing code to reuse)

- **The engine already exists** in the EE chat assistant:
  - `ee/server/src/services/chatCompletionsService.ts` — agent loop; `buildToolDefinitions()` (~line 958) defines the meta-tools `search_api_registry`, `search_business_data`, `call_api_endpoint`, `finish_response`; `executeFunctionCall()` (~line 3317) dispatches via a temp API key; `searchBusinessData()` (~line 1206) calls server-internal full-text search.
  - `ee/server/src/chat/registry/apiRegistry.schema.ts` — `ChatApiRegistryEntry` (carries `rbacResource`, `approvalRequired`, `parameters`, request/response schemas, `examples`, `playbooks`). **Pure types.**
  - `ee/server/src/chat/registry/search.ts` — `searchRegistryEntries()` ranked search. **Pure TS, imports only the schema type → trivially extractable.**
  - `ee/server/src/chat/registry/apiRegistry.generated.ts` — generated registry (~1.2MB).
  - `ee/scripts/generate-chat-registry.mjs` — generator from OpenAPI; supports YAML overrides in `ee/docs/api-registry/`.
- **OpenAPI specs exist for both editions:** `sdk/docs/openapi/alga-openapi.ce.json` and `…ee.json` (+ yaml). Generator: `sdk/scripts/generate-openapi.ts`.
- **HTTP surfaces the connector needs already exist:**
  - Global search: `server/src/app/api/v1/search/route.ts` (+ per-entity `*/search`).
  - Meta endpoints: `server/src/app/api/v1/meta/{openapi,endpoints,schemas,sdk}` — precedent for adding `meta/mcp-registry`.
- **API-key auth:** `server/src/lib/api/middleware/apiAuthMiddleware.ts` (`x-api-key` / Bearer, `api_keys` table). Subject already carries `apiKeyId`.
- **Authz kernel:** `server/src/lib/authorization/kernel/{contracts.ts,engine.ts}`. `AuthorizationSubject` is open-shaped (`[key: string]: unknown`) → can add `agentId` + subject type `'agent'`.
- **Audit:** `server/src/lib/logging/auditLog.ts` → `audit_logs` table. `auditLog(knex, {userId, operation, tableName, recordId, changedData, details})`.
- **Edition gating:** `server/src/lib/features.ts` — `isEnterpriseEdition()`, `getFeatureImplementation()`. EDITION env (`community`|`ee`|`enterprise`).
- **Monorepo:** npm workspaces (root `package.json`), Nx. New CE pkg → `packages/agent-tooling`; connector → `packages/alga-mcp-connector` (or `@alga/mcp-connector`); remote endpoint lives in the server app under `ee/`.

## Decisions (see design.md §8)

1. Progressive disclosure: 3 constant meta-tools, no per-endpoint tools.
2. Extract engine to shared CE package `agent-tooling`; chat + both MCP transports consume it.
3. **Anything networked is EE** (tightens source spec §3.2/§6 — remote base is no longer CE).
4. MCP Resources dropped from scope (subsumed by progressive disclosure).
5. Registry **fetched from the instance** (`meta/mcp-registry`), not bundled (avoids fleet drift).
6. Local connector reuses existing `api_keys` mechanism — no new token type.
7. Phase order: CE local → EE remote (MVP gov) → governance depth.
8. Temp-key-from-session dispatch stays EE (chat); connector calls `/api/v1` directly with user token.

## Open questions / deferred

- **Deferred:** approval-gate resolution over request/response MCP (Phase 3 design spike) — candidates: `pending_approval` handle resolved via Streamable HTTP streaming within timeout, or a `check_approval(handle)` tool.
- Do `/api/v1/search` ACL semantics match the chat assistant's internal ACL path, or need reconciliation?
- OAuth: AlgaPSA-as-authorization-server vs. delegate to tenant IdP (P2 vs SSO-bound identity in P3).

## Testing posture

**80/20 by explicit user directive** — lean test list, high-value risks only. This intentionally **overrides** the software-planner default of "tests > features." Do not exhaustively test thin pass-throughs.

## Commands / runbooks

- Generate registries (to be generalized for CE+EE): `node ee/scripts/generate-chat-registry.mjs`
- Build editions: `npm run build:ce` / `npm run build:ee`
- OpenAPI regen: `sdk/scripts/generate-openapi.ts`

## Gotchas

- `searchBusinessData()` in chat uses server-internal DB search (`createTenantKnex`, ACL principal) — **not** reachable from a workstation connector. The connector must use the HTTP `/api/v1/search` endpoint instead.
- Re-pointing the chat assistant onto `agent-tooling` is the only shipped-code change in Phase 1 → regression-test the existing chat flow.
- Registry is ~1.2MB; serve gzipped from `meta/mcp-registry`.

## Implementation log / surprises

### 2026-06-06 — Group A (F001-F003): agent-tooling package extracted
- Created `packages/agent-tooling` (CE), mirroring `packages/formatting` conventions (src-export map, tsup preset, project.json, vitest). Typechecks + builds + 6 search tests pass.
- **Decision:** *copy* schema+search into the package and leave `ee/server/src/chat/registry/*` untouched for now (brief, intentional duplication). The EE chat re-point + de-dup is Group D — deferred so the connector (Group F) lands first with **zero** changes to the build-critical `server/next.config.mjs` or shipped chat code.
- **Sequencing change vs features.json order:** executing A → B → F (standalone connector, no Next.js) BEFORE C → E → D (server integration + next.config edits + chat re-point). Risk pushed later; value (working CE connector) lands first.
- **SURPRISE — search never returns empty for a non-empty query.** `scoreEntry` adds an unconditional recency bonus `Math.max(0, 2 - index*0.05)`, so the first ~40 registry entries always score > 0 even with zero token/intent match. Implication for MCP: `search_api_registry` on an irrelevant query returns low-relevance entries (by registry order), not an empty set. The agent must judge relevance from the returned scores/descriptions. Consider surfacing the `score` in the MCP tool result so the model can tell "weak match" from "strong match". Not changing the algorithm now (parity with shipped chat behavior).
- **next.config.mjs reality:** per-package webpack aliases exist in TWO blocks (dev-source ~L230-274 and prebuilt ~L515-544) plus a `transpilePackages` list (~L413). Group E/D must add `@alga-psa/agent-tooling` to all three. Build-critical file — edit carefully.
