# PRD — AlgaPSA MCP Server

**Date:** 2026-06-06 · **Branch:** `feature/alga-mcp-server` · **Design:** `design.md` (this folder, source of truth)

## Problem statement & user value

AlgaPSA has open APIs but no first-class way for AI agents (Claude Desktop, Cursor, custom agents) to operate it. We want to expose AlgaPSA over MCP so agents can search, read, and act on PSA data. The free/open surface drives adoption; the monetizable value is **governance + managed hosting** around agent access, not access itself.

Naively exposing one MCP tool per API endpoint is a non-starter — 40–400+ tool definitions blow the context window and *degrade* tool selection. Instead we expose a tiny constant surface and let the agent discover capabilities on demand (**progressive disclosure**), reusing the agentic engine AlgaPSA already built for its EE chat assistant.

## Goals

- Expose AlgaPSA to MCP clients via **3 constant meta-tools** (`search_api_registry`, `search_business_data`, `call_api_endpoint`) regardless of API size.
- Ship a **free CE local stdio connector** users run on their workstation, acting under their own API token + RBAC/ABAC.
- Ship an **EE remote Streamable HTTP server** (OAuth 2.1, agent identity, audit) that is the seam between free and paid.
- Reuse the existing chat engine by **extracting it into a shared CE package** consumed by chat + both MCP transports.
- Layer **governance depth** (agent ABAC, approval gates, quotas, SSO-bound identity) on the remote path.

## Non-goals

- AlgaPSA as an MCP **client** (consuming external servers).
- Metered inference / model-serving.
- Changes to the event-driven workflow/routing engine.
- **MCP Resources** — dropped; progressive disclosure subsumes them.
- Legacy HTTP+SSE transport — Streamable HTTP only.
- Operational gold-plating (extra metrics/monitoring/health beyond the product's own audit requirement).

## Target users / personas

- **End user / power user (CE):** runs the local connector, drives AlgaPSA from their MCP client under their own permissions.
- **MSP admin (EE):** stands up the remote server on an appliance/SaaS, provisions agent identities, defines policy, reviews audit.
- **External AI agent (EE):** a non-human principal connecting over OAuth, governed by ABAC + approval + quotas.

## Primary flows

1. **Local (CE):** configure connector with `ALGA_INSTANCE_URL` + `ALGA_API_TOKEN` → connector fetches registry from instance → agent does `search_api_registry` → reads one schema → `call_api_endpoint` → result, all under the user's RBAC.
2. **Remote (EE):** admin enables `/api/mcp`; agent client performs OAuth 2.1 (auth-code+PKCE) → token resolves to an agent subject → tool calls dispatched through the authz kernel → every action audited.
3. **Governed (EE, P3):** admin authors agent ABAC policy (e.g., read-only on billing), requires approval for designated mutations (e.g., bulk close), exports the audit trail.

## Architecture / integration notes

See `design.md` §4. One engine, two transports:

- `packages/agent-tooling` (CE) — registry + ranked search + request-building + 3 tool-def schemas. Mechanism only; no LLM, transport, or governance.
- Dispatch splits by caller: chat keeps temp-key-from-session (EE); connector calls `/api/v1` directly with the user token.
- Registry generated from `alga-openapi.{ce,ee}.json`; served per-instance via `GET /api/v1/meta/mcp-registry`.
- Remote endpoint embedded in the server app under `ee/`, gated by `isEnterpriseEdition()`.
- Agent identity extends `AuthorizationSubject` (`agentId`, subject type `'agent'`); enforcement reuses the kernel; audit reuses `auditLog()`/`audit_logs`.

## Phases & acceptance criteria

### Phase 1 — Local connector (CE) — ships first
**Done when:** a user configures the connector with URL + token and operates AlgaPSA from Claude Desktop under their own permissions; the EE chat assistant still works after being re-pointed onto `agent-tooling`.
- Extract `packages/agent-tooling`; move registry types + `search.ts`; add request-building + tool-defs.
- Generalize registry generation to emit CE **and** EE registries.
- `GET /api/v1/meta/mcp-registry` (auth-guarded, edition-aware).
- `@alga/mcp-connector` (npx, stdio) exposing the 3 tools; structured tool errors; clear 401.
- Re-point EE chat assistant onto the package.

### Phase 2 — Remote server, MVP governance (EE)
**Done when:** an admin stands up the remote server on an appliance and connects a client over OAuth; agent actions are attributable to an agent identity and audited/exportable.
- `/api/mcp` Streamable HTTP (EE-gated) exposing the 3 tools.
- OAuth 2.1 resource server (protected-resource metadata, auth-code+PKCE, DCR); AlgaPSA as/fronting AS.
- Agent identity subject; admin provisioning; per-agent permissions via RBAC roles.
- Dispatch through kernel under agent subject (reads auto; mutations permission-gated).
- Audit of every invocation + export.

### Phase 3 — Governance depth (EE)
**Done when:** an admin defines a policy restricting an agent to read-only on billing data, requires approval for bulk ticket closes, and gets an exportable audit trail.
- Agent subject type in kernel policy (agent-specific ABAC) + policy authoring.
- Approval gates: holding queue, approve/reject UI, timeout. *(Approval-resolution mechanism over MCP is a deferred design spike.)*
- Per-agent / per-tenant quotas extending `enforceApiRateLimit`.
- SSO-bound agent identity via tenant IdP.

## Risks & mitigations

- **Regression in shipped chat** from extraction → re-point carefully, regression-test the chat flow (T006).
- **Registry drift across self-hosted fleet** → fetch from instance, not bundle.
- **Approval over request/response MCP** is unsolved → carry as explicit deferred sub-decision; don't block P1/P2.
- **OAuth complexity** → P2 may use AlgaPSA-as-AS; full IdP/SSO binding deferred to P3.

## Testing (80/20 — explicit directive)

Lean, high-value tests only (search ranking, request-building, dual-edition registry gen, chat regression, one MCP conformance per transport, EE OAuth+agent-authz+audit-completeness). This **intentionally overrides** the default "tests > features." No exhaustive testing of thin pass-throughs.

## Definition of done (per phase)

Feature items for the phase are `implemented: true`, the phase's acceptance criterion is demonstrably met, the lean test set for that phase passes, and `SCRATCHPAD.md` reflects any new decisions.
