# AlgaPSA MCP Server

AlgaPSA exposes its functionality to AI agents over the **Model Context Protocol (MCP)**
through a small, constant **3-tool** surface (progressive disclosure) rather than one tool
per API endpoint:

| Tool | Purpose |
|------|---------|
| `search_api_registry` | Find the right API endpoint by natural-language query |
| `search_business_data` | Find tenant records (tickets, clients, …), ACL-scoped |
| `call_api_endpoint` | Execute a chosen endpoint |

There are two delivery forms.

## 1. Local connector (CE / free)

A workstation tool the user runs alongside an MCP client (Claude Desktop, Cursor). It calls
the AlgaPSA API under the **user's own** API token, inheriting their RBAC/ABAC. No agent
governance — the user's MCP client is the human-in-the-loop.

**Setup:**
1. AlgaPSA → **Settings → API Keys** → create a key.
2. Add to the MCP client config:
   ```json
   {
     "mcpServers": {
       "alga-psa": {
         "command": "npx",
         "args": ["-y", "@alga-psa/mcp-connector"],
         "env": { "ALGA_INSTANCE_URL": "https://alga.example.com", "ALGA_API_TOKEN": "your-api-key" }
       }
     }
   }
   ```

Full details: [`packages/alga-mcp-connector/README.md`](../packages/alga-mcp-connector/README.md).

## 2. Remote governed server (EE)

A networked MCP endpoint (`POST /api/mcp`, Streamable HTTP / JSON-RPC) that authenticates
**agents** via the tenant's identity provider and enforces governance: distinct agent
identity, RBAC, and an exportable audit trail. Enterprise-only.

### Auth model — OAuth 2.1 resource server (IdP delegation)

AlgaPSA is an OAuth 2.1 **resource server** only; it does **not** issue tokens. Tokens come
from the **tenant's IdP** (Entra / Google / Keycloak). On an unauthenticated request the
server returns `401` + `WWW-Authenticate` pointing at the Protected Resource Metadata
(`/.well-known/oauth-protected-resource`, RFC 9728), which names the trusted IdP(s). The
server validates the bearer JWT (issuer, audience/resource, signature via JWKS) and maps
the configured **subject claim** to a provisioned agent.

> **Requirement:** a remote MCP server needs the tenant to have an IdP that can issue tokens
> to a machine agent (client-credentials / service principal). A bare appliance with no IdP
> can still run the free local connector.

### Admin setup (the journey)

Either from the UI (**Settings → MCP Server**, EE only) or the admin API:

1. **Register the trusted IdP** — issuer, JWKS URI, audience (= your `/api/mcp` URL), and the
   subject claim (`sub` / `azp` / `client_id`).
   `POST /api/v1/mcp/idp-providers`
2. **In the IdP**, register the agent as an OAuth client (client-credentials / service
   principal) → note its `client_id`/subject.
3. **Provision the agent** — name, IdP issuer + subject, and the RBAC roles it may use.
   `POST /api/v1/mcp/agents`
4. The agent's MCP client connects to `/api/mcp`; on `401` it reads the PRM, gets a token
   from the IdP (resource = the `/api/mcp` URL), and connects.
5. **Review/export audit** — `GET /api/v1/mcp/audit?agentId=…` or the UI audit viewer.

Agents operate **only within their assigned roles** (an agent without a permission is
denied), and **every tool call is audited** (identity, tool, inputs, decision, status).

### Admin API reference (EE, session-admin or API-key auth)

| Method | Path | |
|--------|------|--|
| GET/POST | `/api/v1/mcp/idp-providers` | list / add trusted IdPs |
| GET/POST | `/api/v1/mcp/agents` | list / provision agents |
| GET | `/api/v1/mcp/roles` | assignable MSP roles |
| GET | `/api/v1/mcp/audit` | export agent audit (`?agentId=`, `?limit=`) |

## Edition matrix

| Capability | CE | EE |
|---|:--:|:--:|
| Local stdio connector (user-scoped) | ✓ | ✓ |
| Registry endpoint (`/api/v1/meta/mcp-registry`) | ✓ | ✓ |
| Remote MCP server (`/api/mcp`) + agent identity + IdP auth + audit | — | ✓ |

## Known MVP limitations

- **PRM is instance-wide.** `/.well-known/oauth-protected-resource` lists all trusted issuers
  across tenants. Correct for a **single-tenant appliance**; a multi-tenant SaaS needs a
  per-tenant PRM (tenant hint via host/path) — tracked as a follow-up.
- **Agent session keys** are short-lived (5 min) and swept opportunistically on each agent
  request; a periodic sweep job (`cleanupExpiredAgentKeys`) is also available.
- **Dispatch** runs as a short-lived agent-scoped key against `/api/v1` (kernel-enforced);
  in-process dispatch is a later optimization.
- **Not yet in MVP** (Phase 3): agent-specific ABAC policy, approval gates (human-in-the-loop),
  and quotas/rate-limits.
