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

### 2026-06-06 — Group F (F012-F020): @alga-psa/mcp-connector built
- New `packages/alga-mcp-connector` (publishable, NOT private — the one shippable package). `npx`-runnable bin via tsup `banner` shebang; bundles `agent-tooling` (`noExternal: [/@alga-psa\//]`) so the published artifact only needs the public MCP SDK at runtime. Verified: `searchRegistryEntries` is inlined in the 25KB dist bin.
- **Decision — low-level `Server` API, not `McpServer`+Zod.** `buildMetaToolDefinitions` already emits raw JSON-Schema `inputSchema`, which maps 1:1 to the low-level `ListToolsRequestSchema` handler. Avoids re-expressing schemas in Zod.
- **Decision — connector always uses `edition: 'ce'` tool templating** (no approval clause) regardless of the instance edition that served the registry — the local connector is inherently user-scoped. EE templating is for the Phase-2 remote server.
- **Conformance proven in-memory (T011):** `InMemoryTransport.createLinkedPair()` + SDK `Client` ↔ our server. listTools → exactly the 3 tools; callTool search works; HTTP-failure → `isError`. Fail-fast verified by running the built bin with no env (clear stderr msg, exit 1). stdout kept clean (all logs → stderr).
- **SURPRISE — MCP SDK 1.29 pulls ~50 transitive deps (express, ajv, hono, eventsource, …).** It bundles the Streamable-HTTP server transport, so even a stdio-only connector drags the HTTP stack in at install. Harmless (tree-shaken from our bundle; runtime only needs the SDK), but worth knowing. `package-lock.json` now pins `@modelcontextprotocol/sdk@1.29.0` — committed with this group.
- **OPEN — tenant header.** Connector relies on API-key→tenant resolution and adds `x-tenant-id` only if `ALGA_TENANT_ID` is set. Must verify against a live instance whether `apiAuthMiddleware` requires the tenant header for `validateApiKeyAnyTenant`. Tracked for Group G live E2E.
- **Contract pinned for Group E:** connector expects `GET /api/v1/meta/mcp-registry` → JSON `{ entries: [...] }` (also tolerates a bare array), auth via `x-api-key`. `search_business_data` → `GET /api/v1/search?query=&types=csv&limit=&cursor=&sort=` (confirmed against `ApiSearchController`).
- T012 (live E2E) deferred to Group G — will drive the built bin over real stdio against a local mock HTTP instance.

### 2026-06-06 — Group C (F006, T005): dual-edition registry generation
- Generalized `ee/scripts/generate-chat-registry.mjs` to emit **both** editions in one run (CE → `server/src/lib/mcp/registry.generated.ts`, EE → existing location). CE file imports the type from `@alga-psa/agent-tooling/registry/schema`. Added root npm script `mcp:registry:generate`. T005 is enforced **in the generator** as a hard invariant: it throws if any CE endpoint is absent from EE.
- Added `@alga-psa/agent-tooling` to `tsconfig.base.json` paths — the repo resolves `@alga-psa/*` types via tsconfig `paths` (not the package `exports` map), and the package emits no `.d.ts` (preset `dts:false`). This is why the IDE flagged "Cannot find module"; the connector's own `tsc` passed because it uses `moduleResolution: Bundler`. The base-paths entry fixes IDE + global typecheck and is required for the server (Group D/E) to import the package.
- **SURPRISE — the committed EE chat registry is STALE.** Regenerating from the current EE spec went **609 → 901 entries** (+292 real endpoints, e.g. inboundwebhooks). The committed registry was generated 2026-04-29; the EE spec was updated 2026-06-04. So the in-app chat is currently ~292 endpoints behind its own API spec.
  - **Decision:** did NOT refresh the EE registry in this commit — it's a 14k-line, chat-behavior-changing diff unrelated to the MCP extraction, and warrants its own review. Reverted the EE regeneration; committed only the new CE registry. **Consequence:** committed CE (879, fresh) is briefly *larger* than committed EE (609, stale); they serve independent consumers, so no runtime issue, but the CE⊆EE invariant only holds on a fresh dual generation.
  - **Follow-up to surface to the user:** run `npm run mcp:registry:generate` and commit the refreshed EE registry separately (also refreshes the connector's view of an EE instance via the meta endpoint). Both the chat and EE-instance MCP currently see the stale set.

### 2026-06-06 — Group E (F009-F011): GET /api/v1/meta/mcp-registry
- Added `getMcpRegistry()` to `ApiMetadataController` + route `server/src/app/api/v1/meta/mcp-registry/route.ts`. Auth via the shared `authenticate()` + `assertProductApiAccess` (F010). Returns `{ edition, count, entries }`.
- **Edition-aware with ZERO next.config changes (F011).** CE registry is `await import('@/lib/mcp/registry.generated')`; on EE, `await import('@product/chat/entry').eeMcpRegistry` (added that export to `packages/product-chat/ee/entry.tsx`, the established CE→EE seam used by the chat routes). Falls back to CE if the EE artifact is missing.
- **Why no next.config alias was needed:** changed the generator to emit `import type { ChatApiRegistryEntry }` in the registry files → the schema import is erased at runtime, so the CE registry never pulls `@alga-psa/agent-tooling` into the server's runtime graph. Regenerated the CE registry with this. (The agent-tooling webpack alias is only needed for Group D, when the chat *runtime* imports the package.)
- LSP shows `@ee/*` "cannot find module" for product-chat/ee/entry.tsx — that's the file's normal state (the `@ee/` alias resolves only in the EE build), and affects the pre-existing service imports identically. Not a regression.
- **T007 (live endpoint auth + edition) NOT auto-tested** — a Next route handler needs the full server/DB/auth stack (poor 80/20). Auth is the shared, already-tested middleware; the edition branch is trivial; the registry-fetch *contract* is covered by the Group G connector E2E against a mock instance. Validate the real endpoint via a running dev server (manual).

### 2026-06-06 — Group D (F007, F008): re-point EE chat onto agent-tooling
- Replaced `ee/server/src/chat/registry/{apiRegistry.schema,search}.ts` with **thin re-export shims** → `@alga-psa/agent-tooling/registry/{schema,search}`. De-dups the ~360 lines that were copied into the package in Group A. Every existing import path (indexer, generated registry, chatCompletionsService) keeps resolving via the shim. Behavior is identical **by construction** (verbatim re-export of the same code).
- **F008 preserved:** the temp-key-from-session dispatch (`executeFunctionCall` + `TemporaryApiKeyService`) stays in EE `chatCompletionsService`; the package only does request-*building*. Chat's own OpenAI/Vertex-shaped `buildToolDefinitions` (with `finish_response` + business-search enum) stays in EE too — intentionally NOT replaced by the package's MCP-shaped `buildMetaToolDefinitions` (different transport/format).
- **next.config.mjs:** added `@alga-psa/agent-tooling` (+`/` subpath variant) in all three places, mirroring the source-transpiled `scheduling`/`formatting` packages exactly: turbopack `resolveAlias`, `transpilePackages`, and the webpack `config.resolve.alias` "Source-transpiled" block. This runtime alias is needed (unlike Group E) because the chat imports `searchRegistryEntries` as a runtime value. Verified the config still parses/loads (`node import()`); agent-tooling + connector tests still pass.
- **⚠️ FINAL GATE I could NOT run in-session:** a full EE/CE Next build (`npm run build` / `npm run dev`) to confirm the webpack/turbopack alias resolves at build time. The edits mirror a known-working package precisely and the config parses, but a real build is the definitive check. **Surface this to the user.**
- **T006 (chat regression) left implemented=false:** behavior is preserved by construction, but the live chat flow (LLM + server) wasn't exercised. Verify on a running dev server.

### 2026-06-06 — Group G (F021, T009, T012): Phase 1 E2E
- Added `e2e.test.ts`: a mock AlgaPSA HTTP instance + the **real** `InstanceClient` + the **real** MCP protocol (InMemory transport). Drives the full path: registry fetch → `search_api_registry` → `call_api_endpoint` → `GET /api/v1/tickets/{id}`, plus a 401 auth-failure case. 17 connector tests pass.
- Covers T009 (real `/api/v1` dispatch + parsed result) and T012 (lists + reads a ticket). F021 acceptance is faithfully *simulated* (real HTTP + protocol); real Claude-Desktop verification is manual.

## PHASE 1 STATUS — COMPLETE (pending live gates)
**Done & committed (8 commits):** `agent-tooling` package (registry/search/request-build/tool-defs), `@alga-psa/mcp-connector` stdio bin, dual-edition registry generation + CE artifact, `GET /api/v1/meta/mcp-registry`, EE chat re-pointed onto the shared package. **21/21 Phase-1 features; 10/12 Phase-1 tests** (29 automated tests across the two packages all green).

**Live gates I could NOT run in-session (surface to user):**
1. **EE/CE Next build** (`npm run build` / `npm run dev`) — validates the Group D `next.config` alias resolves at build time. Edits mirror `scheduling`/`formatting` exactly; config parses; but a real build is the definitive check. (→ T006 chat regression + T007 endpoint auth ride on this.)
2. **EE registry is stale** (609 vs 901) — run `npm run mcp:registry:generate`, review, commit separately.
3. **Connector tenant header** — verify whether `/api/v1` needs `x-tenant-id` or resolves tenant from the API key (set `ALGA_TENANT_ID` if required).

**Phases 2–3 (EE remote + governance) NOT started** — F022-F043. F022/F023 (Streamable HTTP transport + 3 tools, EE-gated) are implementable now (analogous to the connector). F024+ (OAuth 2.1, agent identity, ABAC, approval gates, quotas, SSO) need product decisions first: OAuth AS-vs-IdP strategy, and the deferred approval-over-request/response mechanism.

## LIVE BRING-UP (2026-06-07) — both MCPs running against the dev server (:3001, EE)

Dev server: `feature/alga-mcp-server/server`, Next 16.2.6, `PORT=3001 npm run dev` (nx `server:next:dev`), `NEXT_PUBLIC_EDITION=enterprise` (from server/.env). DB: docker `algamcp-postgres-1`. Test API key minted via DB insert (SHA-256 of a random token; internal user dorothy@kansas.oz; saved at /tmp/alga_mcp_token.txt, description 'mcp-test-key').

**EE-BUILD GATE CLEARED.** Restarted the dev server to pick up the Group-D `next.config` agent-tooling alias. `/api/mcp` `tools/list` returned the 3 tools — i.e. `buildMetaToolDefinitions` (an agent-tooling **runtime** value) resolved at runtime. So the turbopack/webpack alias + transpilePackages edits are correct. Server booted clean; chat path (search.ts shim runtime value) implicitly exercises the same alias.

**LOCAL MCP — works.** Built bin driven over real stdio (SDK StdioClientTransport) against :3001: `search_api_registry('list tickets')` → `get-_api_v1_tickets`; `call_api_endpoint` → HTTP 200, real ticket "Ruby Slippers Server Power Fluctuation"; `search_business_data` → valid response. Re-verified after the server restart.

**SERVER MCP — works.** New EE-gated `POST /api/mcp` (Streamable HTTP, JSON-RPC). Synthetic curl drive: unauth → 401; `initialize` → protocol result; `tools/list` → 3 tools; `tools/call search_api_registry` → ranked; `tools/call call_api_endpoint(get-_api_v1_tickets)` → HTTP 200 real ticket.

**BUG FOUND + FIXED via live test:** the connector's `fetchRegistry` only read top-level `entries`, but the real endpoint returns Alga's `{ data: { entries } }` envelope → connector couldn't parse the registry. Fixed `instanceClient.fetchRegistry` to unwrap `data`; updated the E2E mock to use the envelope. (Pure-unit tests had missed it because the mock returned a bare `{entries}`.)

**NOTES / not-yet-done:**
- `app_search_index` has **0 rows** in this dev DB → `search_business_data` correctly returns empty. Tool is fine; the index just isn't populated.
- Server MCP **auth is an MVP stand-in: Alga API key** (`x-api-key`/Bearer validated via `validateApiKeyAnyTenant`), NOT the designed IdP-delegated OAuth (F024/F025). The 401 also advertises a `WWW-Authenticate: ...resource_metadata` header, but the PRM endpoint isn't built yet.
- Server MCP **dispatch is self-HTTP** to `/api/v1` under the caller's key (reuses agent-tooling `buildRequest`), NOT the designed in-process kernel dispatch under an agent subject (F031). Good enough to prove the transport + tool surface; swap to kernel dispatch when agent identity (F027) lands.
- So **F022 (transport) + F023 (3 tools over remote) = done (MVP)**; F024-F033 (OAuth/IdP, agent identity, audit) remain.
