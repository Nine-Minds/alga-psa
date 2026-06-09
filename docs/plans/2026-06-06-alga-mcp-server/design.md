# AlgaPSA MCP Server — Design

**Date:** 2026-06-06
**Branch:** `feature/alga-mcp-server`
**Status:** Approved design (brainstorming output) → feeds PRD/feature/test plan in this directory.

---

## 1. Intent

Expose AlgaPSA to AI agents over the Model Context Protocol (MCP). AlgaPSA acts as an MCP **server** only (not a client). MCP is the human/agent-initiated **pull** surface; the event-driven routing engine remains the system-initiated **push** surface — out of scope here.

The strategic stance: the protocol and basic local access are free/open (adoption funnel, reconstructable from the open API anyway); the monetizable value is **governance + managed hosting** around agent access.

## 2. The central reframe (why this design diverges from a naive adapter)

The source product description (§4) implied one richly-described MCP tool per entity×operation — ~40+ tools, each description a "product surface." **That is the documented anti-pattern.** Real MCP servers reach 50–400 tools = 55K–400K+ tokens of definitions loaded before the agent reads a request; context chokes and tool-selection accuracy *drops*.

Current state of the art (Anthropic ["Code execution with MCP"](https://www.anthropic.com/engineering/code-execution-with-mcp), Nov 2025; ["Advanced tool use / Tool Search Tool"](https://www.anthropic.com/engineering/advanced-tool-use), Jan 2026; MCP-Zero; meta-tool pattern) converges on **progressive disclosure**: expose a tiny constant surface; let the agent *search* for the capability it needs and pull only that schema on demand. Reported savings: 85–98.7% fewer tokens, with accuracy going *up*.

**Key discovery:** AlgaPSA already built this. The EE chat assistant
(`ee/server/src/services/chatCompletionsService.ts` + `ee/server/src/chat/registry/`)
is mechanically a progressive-disclosure engine wired to an internal LLM loop instead of an MCP transport:

- A **registry generated from the OpenAPI spec** (`apiRegistry.generated.ts`) — every endpoint carries `displayName`, `description`, `parameters`, request/response schemas, plus governance metadata: **`rbacResource` and `approvalRequired` per endpoint**, and curated `examples`/`playbooks` (YAML-overridable).
- A **ranked search** over it (`chat/registry/search.ts`) — intent detection + token scoring, returns top-N. **Pure TypeScript, zero EE dependencies.**
- The **exact meta-tool surface** the SOTA recommends (`buildToolDefinitions`): `search_api_registry`, `search_business_data`, `call_api_endpoint` (+ a loop-only `finish_response`).
- The **read-auto / mutation-gated** split already designed into `call_api_endpoint`'s description.
- Identity threading via `TemporaryApiKeyService.issueForAiSession()`.

So the MCP server is **~80% existing engine + a thin transport**, not new business logic.

## 3. Tool surface — 3 constant meta-tools

The MCP surface is **3 tools, constant, independent of API size.** No per-endpoint tools.

| MCP tool | Purpose | Execution |
|---|---|---|
| `search_api_registry(query, limit)` | Ranked search over the endpoint catalog; returns top-N descriptors (id, name, params, schema, examples) | read-only, immediate |
| `search_business_data(query, types)` | Cross-entity record search → `GET /api/v1/search`, ACL-scoped | read-only, immediate |
| `call_api_endpoint(entryId, path?, query?, body?)` | Execute the chosen endpoint | read auto; mutation gated (EE remote only) |

The agent loop is run by the **client** (Claude Desktop/Cursor), not by AlgaPSA: `search_api_registry` → read one schema → `call_api_endpoint`. `finish_response` is dropped (server-loop artifact; in MCP the host model ends its own turn).

- `call_api_endpoint`'s description is **edition-templated**: in the CE local connector there is *no* approval (the agent acts under the user's own token + RBAC; the user's MCP client is itself the human-in-the-loop). The approval clause only becomes real on the EE remote path.
- **MCP Resources are out of scope.** Progressive disclosure subsumes them — any read is reachable via search + `call_api_endpoint`, so a parallel resource surface is redundant maintenance. Revisit only if a specific client needs @-mention/attach UX.

## 4. Architecture — one engine, two transports, shared with chat

```
        packages/agent-tooling/   ← NEW shared CE package (the "engine")
        ┌─────────────────────────────────────────────────┐
        │  registry/   generated from alga-openapi.<ed>.json (CE + EE)
        │  search.ts   ranked search (moved as-is, already pure)
        │  invoke/     build request from a registry entry → {method,path,...}
        │  tool-defs/  the 3 meta-tool schemas + descriptions
        └─────────────────────────────────────────────────┘
              ▲                    ▲                     ▲
   EE chat assistant     CE local connector     EE remote server
   (re-pointed onto       stdio transport        Streamable HTTP + OAuth,
    the package)          runs ON workstation     governance; embedded in
   runs loop server-      calls instance          server app (appliance/SaaS)
   side, mints temp       /api/v1 w/ user token
   keys from session
              └──────────── all dispatch → existing /api/v1 (no new business logic) ─────────────┘
```

**Boundaries:**
- `packages/agent-tooling` holds only *mechanism* (registry, search, request-building, the 3 tool-def schemas). No LLM code, no transport, no governance → CE-safe and reusable. `search.ts` + schema move essentially as-is.
- **Dispatch splits by caller.** The chat assistant's temp-key-from-session path **stays in EE**. The local connector already holds the user's API token → calls `/api/v1` directly, no temp-key machinery. The package exposes request-*building*; each consumer owns request-*sending* + auth.
- The existing EE chat assistant is **re-pointed** onto the package — the one place shipped code is touched; carries regression risk; must retest existing chat behavior.

## 5. CE / EE seam (diverges deliberately from source spec §3.2/§6)

The source spec had a CE self-hosted remote *base* with only governance gated. **This design tightens that: anything networked is EE.**

| Surface | Edition |
|---|---|
| Local stdio connector (full 3-tool surface, user-scoped via API token) | **CE / free** |
| Shared engine package (`agent-tooling`) | **CE** |
| Remote Streamable HTTP MCP server — the *entire* networked endpoint: OAuth 2.1, multi-client serving, **and** governance | **EE / paid** |
| Managed/hosted remote endpoint (SaaS) | **EE / paid** |

Rationale: "run it yourself on your workstation = free; a networked server many agents connect to = paid" is a crisp, defensible line, and the remote transport is inseparable from the governance/hosting value. The free local connector still provides the full tool surface under the user's identity, honoring "basic access is never gated."

## 6. Phasing

### Phase 1 — Local connector (CE) — *ships first*
- Extract `packages/agent-tooling` from the EE chat code (registry + `search.ts` + request-building + tool-defs).
- Re-point the EE chat assistant onto it (+ regression test).
- Generalize `generate-chat-registry.mjs` to emit **both** CE and EE registries (`alga-openapi.ce.json` / `.ee.json`).
- New server endpoint: **`GET /api/v1/meta/mcp-registry`** serving the generated registry for that instance's edition (precedent: `meta/openapi`, `meta/endpoints` already exist).
- `@alga/mcp-connector` — `npx`-run Node package on `@modelcontextprotocol/sdk` `StdioServerTransport`, exposing the 3 tools.
  - Config via env: `ALGA_INSTANCE_URL` + `ALGA_API_TOKEN` (an existing `api_keys` key; no new auth).
  - Startup: fetch registry from the instance (source of truth for version + edition). Decision: **fetch from instance**, not bundle (avoids drift across a heterogeneous self-hosted fleet).
  - Dispatch: `search_api_registry` → in-memory search; `search_business_data` → `/api/v1/search`; `call_api_endpoint` → build request + send with the user's token.
- Identity = the user's token → inherits RBAC/ABAC. No agent identity, no approval, no governance (intentional, §3.1).
- **Acceptance:** a user configures URL + token and operates AlgaPSA from Claude Desktop under their own permissions.

### Phase 2 — Remote server, MVP governance (EE)
- Streamable HTTP single endpoint (`/api/mcp`) via SDK `StreamableHTTPServerTransport`, embedded in the server app. No legacy HTTP+SSE.
- **OAuth 2.1** per MCP authorization spec: MCP endpoint is an OAuth resource server; advertises `.well-known/oauth-protected-resource`; auth-code + PKCE; Dynamic Client Registration. AlgaPSA acts as / fronts the authorization server.
- **Agent identity** as a first-class subject: extend `AuthorizationSubject` (already open-shaped, already carries `apiKeyId`) with `agentId` + subject type `'agent'`, admin-provisioned per tenant. Because it's a kernel subject, its permissions are enforced by the existing authz kernel; basic per-agent permissions reuse existing RBAC roles.
- **Audit** of every agent action via existing `auditLog()` / `audit_logs` (identity, tool, inputs, policy decision, result, timestamp), exportable.
- Dispatch runs *inside* AlgaPSA → through the kernel under the agent subject. Reads auto-execute; mutations execute only if agent permissions allow, and everything is audited. (Hold-for-human approval is Phase 3.)
- **Acceptance:** an admin stands up the remote server on an appliance and connects a client over OAuth; agent actions are attributable and audited.

### Phase 3 — Governance depth (EE)
- **Agent-specific ABAC policy** — which agent may invoke which tools, on which resources, under which conditions; add the agent subject type to the kernel's bundle/narrowing policy evaluation.
- **Approval gates (human-in-the-loop)** — registry already carries `approvalRequired`; chat already has a propose→`/api/chat/v1/execute` flow to mirror. New: holding queue, approve/reject UI, timeout policy.
  - ⚠️ **Open sub-decision (deferred, needs more thought):** how a *held* mutation resolves over request/response MCP. Candidate shapes: gated call returns a `pending_approval` handle, resolved via Streamable HTTP streaming the eventual result within the timeout, or via a `check_approval(handle)` tool. Not pinned in this design.
- **Quotas & rate limits** — per-agent and per-tenant; extend existing `enforceApiRateLimit` (already used for API keys) to agent subjects; structured to later feed metered usage.
- **SSO-bound agent identity** — agent identity provisioned/bound via the tenant's IdP.
- **Acceptance (§9 EE):** an admin defines a policy restricting an agent to read-only on billing data, requires approval for bulk ticket closes, and gets an exportable audit trail of all agent actions.

## 7. Cross-cutting

- **No business logic in MCP code** — every path terminates at `/api/v1` (Phase 1) or kernel→API dispatch (Phase 2+). MCP layer only discovers, builds, dispatches, audits.
- **Edition gating** via existing `isEnterpriseEdition()` / `getFeatureImplementation()`. Remote + governance in `ee/`; `agent-tooling` + connector are CE.
- **Fail-fast** per repo standards: validate inputs early, throw actionable errors. But tool *execution* errors surface to the agent as structured tool errors (not thrown) so the model can recover.
- **Security:** token never logged; registry endpoint requires auth; OAuth scopes map to agent permissions; audit append-only.
- **Testing (80/20):** invest in the few tests that de-risk the most — search ranking, request-building from a registry entry, dual-edition registry generation, and the chat-assistant regression after re-pointing. One MCP-protocol conformance check per transport. EE: OAuth flow + agent-subject authz + audit-completeness. Do **not** exhaustively unit-test thin pass-throughs.

## 8. Decisions log (divergences + commitments)

1. **Progressive disclosure, not per-endpoint tools** — 3 constant meta-tools. (Reframe of source §4.)
2. **Reuse the existing chat engine** by extracting it to a shared CE package `agent-tooling`. (Not greenfield.)
3. **Anything networked is EE** — the remote server in its entirety, not just governance. (Tightens source §3.2/§6.)
4. **MCP Resources dropped from scope** — subsumed by progressive disclosure.
5. **Registry fetched from the instance**, not bundled into the connector.
6. **Local connector uses the existing `api_keys` mechanism**, no new token type.
7. **Phase order:** CE local first, then EE remote (MVP governance), then governance depth.
8. **Deferred:** the approval-gate request/response mechanism (Phase 3 open sub-decision).

## 9. Open questions for implementation

- ~~AlgaPSA-as-authorization-server vs. delegating to tenant IdP~~ → **RESOLVED in §10: delegate to tenant IdP.**
- ~~Approval-gate resolution mechanism~~ → **RESOLVED in §10: pending-handle + `check_approval` poll (Phase 3).**
- Whether `search_business_data` ACL semantics via `/api/v1/search` exactly match the chat assistant's internal ACL path, or need reconciliation.

## 10. Phase 2 design addendum — remote server, identity & auth (decided 2026-06-06)

Grounded in the current MCP authorization spec (2025-11 revision): an MCP server is an **OAuth 2.1 resource server only** — it validates bearer tokens from a separate authorization server, MUST serve Protected Resource Metadata (RFC 9728), and clients bind tokens to the resource via Resource Indicators (RFC 8707). Alga has **no** authorization server today (NextAuth relying-party only).

### 10.1 Decisions
1. **OAuth = delegate to the tenant IdP.** The MCP server is purely a **resource server**. Token issuance is the tenant's existing IdP (Entra / Google / Keycloak — the same providers EE SSO already integrates). Alga validates tokens (issuer + audience + resource indicator + signature via the IdP's JWKS) and maps the token's client/subject claim to an Alga agent. **No Alga-as-AS.**
   - **Accepted constraint:** a remote MCP server therefore *requires the tenant to have an IdP*. A bare appliance with no IdP cannot run the remote server (it can still run the free local connector). Document this prominently; offer Keycloak as the appliance IdP option.
   - This pulls **"SSO-bound agent identity" (was Phase 3 / F042) into the Phase 2 core** — the IdP binding *is* how agents authenticate.
2. **Agent identity = first-class `agents` table.** A real principal, not an api-key alias.
3. **Approval over MCP = pending-handle + `check_approval` tool (poll)** — Phase 3; decouples the Alga-admin approver from the agent; robust on all clients.

### 10.2 Auth flow (resource-server)
```
MCP client → GET /api/mcp (no token)
         ← 401 + WWW-Authenticate: resource_metadata="…/.well-known/oauth-protected-resource"
MCP client → reads PRM → authorization_servers = [tenant IdP]
         → obtains token from the IdP (client-credentials / service principal for a machine agent),
           with resource indicator = the Alga MCP resource URL
MCP client → GET /api/mcp  (Authorization: Bearer <IdP JWT>)
Alga MCP   → validate: issuer ∈ tenant's configured IdPs, aud/resource = this server,
             signature via cached JWKS, not expired
         → extract client_id / sub claim → look up agents.idp_subject → agent principal
         → build AuthorizationSubject{ agentId, subjectType:'agent', tenant, … }
         → dispatch through the existing authz kernel → /api/v1; audit every call
```

### 10.3 Agent identity model
- **`agents` table** (per tenant): `agent_id` (uuid PK), `tenant`, `name`, `description`, `active`, `created_by`, `created_at`, plus the **IdP binding**: `idp_issuer`, `idp_subject` (the `sub`/`azp`/`client_id` claim that identifies this agent in the tenant IdP). Unique on `(tenant, idp_issuer, idp_subject)`.
- **Credentials:** primary path is the IdP token (above). Optionally, an Alga-issued agent credential reuses `api_keys` with a new nullable `agent_id` (and `user_id` made nullable for agent keys) — useful for non-OAuth/dev access and to let the *local connector* act as a registered agent later. Not required for the IdP path.
- **`AuthorizationSubject`** gains `agentId?: string` and `subjectType?: 'user' | 'agent'` (default `'user'`). `buildAuthorizationPrincipalSubject` grows an **agent branch**: given a resolved agent, assemble a subject with the agent's assigned roles/permissions (Phase 2 reuses RBAC roles; Phase 3 adds agent-specific ABAC bundles).
- **Authz kernel unchanged** — it already evaluates whatever subject it's handed; we only teach the *subject builder* about agents.

### 10.4 Reuse map (minimal new surface)
- **Transport:** SDK `StreamableHTTPServerTransport`, single `/api/mcp` route, EE-gated via `isEnterpriseEdition()`. Tool handlers reuse the connector's `search/call` logic but dispatch **in-process through the kernel** (not HTTP-to-self) under the agent subject.
- **JWKS/JWT validation:** reuse `@auth/core/jwt` + `getSecretProviderInstance`; cache JWKS per IdP. IdP config reuses EE `providerConfig` / `ssoProviders` (per-tenant).
- **Audit:** reuse `auditLog()` / `audit_logs` — one row per tool invocation (agent_id, tool, inputs, decision, result, ts).
- **Rate limiting:** reuse `enforceApiRateLimit` with `rateLimitSubjectId = agent_id`.
- **Registry:** the EE registry already served by `GET /api/v1/meta/mcp-registry` (Phase 1).

### 10.5 Revised feature interpretation (Phase 2)
- **F024 (PRM):** serve `/.well-known/oauth-protected-resource` advertising the tenant's IdP as the `authorization_servers`. (Core.)
- **F025 (token flow):** **validate IdP tokens** (issuer/aud/resource/JWKS), not run an Alga auth-code+PKCE flow. (Re-scoped.)
- **F026 (DCR):** **dropped/deferred** — DCR is downgraded to optional in the spec, and with IdP delegation client registration happens at the IdP, not Alga.
- **F042 (SSO-bound identity):** **pulled into Phase 2 core** (it's the auth mechanism), not a Phase-3 add-on.
- **F027-F033** (agent subject, provisioning, mapping, per-agent RBAC, kernel dispatch, audit, export) unchanged in intent.

### 10.6 What still needs live infra / can't be unit-tested here
- A real tenant IdP for the full token round-trip. Unit-testable now: JWKS signature validation (mock JWKS), claim→agent mapping, the `agents` migration + subject builder, EE-gating. End-to-end needs a live IdP (or a mock OAuth server in integration tests).
