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

- Exact shape of the approval-gate resolution over Streamable HTTP (Phase 3).
- Whether `search_business_data` ACL semantics via `/api/v1/search` exactly match the chat assistant's internal ACL path, or need reconciliation.
- AlgaPSA-as-authorization-server vs. delegating to tenant IdP for the OAuth 2.1 flow (Phase 2 vs. SSO-bound identity in Phase 3).
