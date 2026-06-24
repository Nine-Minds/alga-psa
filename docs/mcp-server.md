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

> **Dark release.** The admin UI (**Settings → MCP Server**) is gated behind the
> `mcp-server` PostHog feature flag and is **off by default** — it appears only when the
> tenant is Enterprise *and* the flag is enabled for them. This is a UI-only gate: the
> server endpoints below stay live regardless, so an operator can configure agents via the
> admin API even before the tab is rolled out. See `docs/features/feature-flags.md`.

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

### The easy path — provider presets, reuse, and hosted built-ins

Registering an IdP used to mean typing a raw issuer + JWKS URL + audience. Three layers
now remove that friction, mirroring how AlgaPSA's own Google/Microsoft SSO works.

**1. Provider presets (any edition).** In **Settings → MCP Server** the trusted-IdP form
offers **Microsoft Entra**, **Google**, or **Custom** instead of free text:

- **Google** — nothing to enter. Issuer is fixed (`https://accounts.google.com`), the JWKS
  is fetched via OIDC discovery, and the subject claim defaults to `sub`.
- **Microsoft Entra** — enter only the **Entra tenant id**. The issuer
  (`https://login.microsoftonline.com/{tid}/v2.0`) and JWKS are derived via discovery; the
  subject claim defaults to `azp` (app-only tokens). Use the concrete tenant id, **not**
  `common` — tokens are issued with the concrete `tid`, so `common` won't match on verify.
- **Custom** — the original raw issuer / JWKS / audience / claim path, unchanged.

`POST /api/v1/mcp/idp-providers` accepts `{ kind: 'google'|'microsoft'|'custom', entraTenantId? }`
and resolves issuer + JWKS server-side.

**2. Reuse an existing connection.** If the tenant already linked Microsoft (SSO / email /
Teams), the form shows **"You're already connected to Microsoft — enable agent access?"** and
one-click pre-fills the Entra preset with the known tenant id (read from `microsoft_profiles`).

**3. Hosted built-ins (SaaS, near-zero-config).** On Nine Minds–hosted AlgaPSA, Google and
Microsoft are **pre-trusted** using the shared OAuth apps that already back SSO — so a hosted
tenant can provision agents with **no IdP registration at all**. When the shared-app secrets
are present, the built-in issuers are advertised in the PRM and accepted at token validation
exactly like a registered `agent_idp_providers` row. This covers **interactive / human-delegated**
agents (auth-code + PKCE through the shared app); the customer configures nothing in their own
directory.

**4. "Connect with Microsoft/Google" (hosted, interactive).** With the shared apps present, the
**Settings → MCP Server** agent form shows **Connect with Microsoft** / **Connect with Google**
buttons (`/api/v1/mcp/connect/start` → consent popup → `/api/v1/mcp/connect/callback`). The
callback reads the returned id_token's `iss`/`sub` and the screen pre-fills the agent's issuer +
subject — no client-id or service-account id to paste. The flow is **inert**: it discards every
token and creates nothing; the agent is still provisioned by the admin-authed
`POST /api/v1/mcp/agents`. It captures `sub` (not `oid`/`azp`) on purpose — an interactive
id_token has no `azp`, so the Microsoft built-in falls back to `sub` at validation, matching what
was stored. Unattended service accounts keep the manual "enter identity" path (their token
carries `azp` / a service-account `sub`).

> **Deploy step (hosted):** the shared Microsoft app registration and the Google OAuth client
> must each whitelist `https://<hosted-base>/api/v1/mcp/connect/callback` as a redirect URI, or
> the IdP returns `redirect_uri_mismatch`. This gates turning the Connect buttons on in prod.

### Admin setup (the journey)

Either from the UI (**Settings → MCP Server**, EE only) or the admin API:

1. **Register the trusted IdP** — pick **Google** / **Microsoft Entra** (preset) or **Custom**.
   On hosted SaaS with built-ins, skip this entirely.
   `POST /api/v1/mcp/idp-providers`
2. **Give the agent a directory identity** — see the distinction below. Interactive agents
   reuse the human's IdP login; unattended agents need their own client-credentials principal.
3. **Provision the agent** — name, IdP issuer + subject, and the RBAC roles it may use.
   One agent per `(issuer, subject)` — re-binding an identity already claimed by an active
   agent returns a friendly `409`.
   `POST /api/v1/mcp/agents`
4. The agent's MCP client connects to `/api/mcp`; on `401` it reads the PRM, gets a token
   from the IdP (resource = the `/api/mcp` URL), and connects.
5. **Review/export audit** — `GET /api/v1/mcp/audit?agentId=…` or the UI audit viewer.

Agents operate **only within their assigned roles** (an agent without a permission is
denied), and **every tool call is audited** (identity, tool, inputs, decision, status).

### The key distinction — interactive vs unattended agents

The easy path makes **interactive, human-delegated** agents zero-config: the agent acts as a
signed-in human, so it rides the existing Google/Microsoft login (or the hosted built-ins) and
needs no new directory object.

**Unattended machine agents** (client-credentials, no human in the loop) are the irreducible
exception: a token with no user behind it must come from a **directory identity the customer
owns** — an **Entra app registration** or a **Google service account**. No preset removes that;
it's a property of OAuth, not of AlgaPSA. For these, create the app/service-account in your own
directory, then provision the agent with its `client_id` (Entra `azp`/`appid`) or service-account
`sub` (Google) as the subject. The subject-claim guidance in the form names the right claim per
provider.

### Admin API reference (EE, session-admin or API-key auth)

| Method | Path | |
|--------|------|--|
| GET/POST | `/api/v1/mcp/idp-providers` | list / add trusted IdPs (POST takes `kind`/`entraTenantId` presets or raw custom fields) |
| GET | `/api/v1/mcp/idp-suggestions` | suggested IdP from an existing connection (e.g. linked Microsoft → Entra tenant id) |
| GET/POST | `/api/v1/mcp/agents` | list / provision agents (duplicate `(issuer, subject)` → `409`) |
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
