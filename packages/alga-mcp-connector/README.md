# @alga-psa/mcp-connector

A small **local MCP connector** that exposes your AlgaPSA instance to MCP clients
(Claude Desktop, Cursor, …). It runs on your workstation over **stdio** and acts
entirely under **your own AlgaPSA API token** — every call inherits your existing
RBAC/ABAC permissions. There is no agent governance here; your MCP client is the
human-in-the-loop.

## How it works — progressive disclosure

Instead of exposing one tool per API endpoint (which would flood the model's
context), the connector exposes **three constant meta-tools**, regardless of how
large the AlgaPSA API is:

| Tool | Purpose |
|------|---------|
| `search_api_registry` | Find the right endpoint by natural-language query |
| `search_business_data` | Find tenant records (tickets, clients, …), ACL-scoped |
| `call_api_endpoint` | Execute a chosen endpoint by its registry id |

The agent searches, reads the one schema it needs, then calls it.

## Configuration

Two environment variables are required:

- `ALGA_INSTANCE_URL` — your AlgaPSA base URL, e.g. `https://alga.example.com`
- `ALGA_API_TOKEN` — an AlgaPSA API key (Settings → API Keys)

Optional: `ALGA_TENANT_ID`, `ALGA_REQUEST_TIMEOUT_MS` (default 30000),
`ALGA_REGISTRY_PATH` (default `/api/v1/meta/mcp-registry`),
`ALGA_SEARCH_PATH` (default `/api/v1/search`).

### Claude Desktop

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "alga-psa": {
      "command": "npx",
      "args": ["-y", "@alga-psa/mcp-connector"],
      "env": {
        "ALGA_INSTANCE_URL": "https://alga.example.com",
        "ALGA_API_TOKEN": "your-api-key"
      }
    }
  }
}
```

### Cursor

Add to `~/.cursor/mcp.json` (or the project `.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "alga-psa": {
      "command": "npx",
      "args": ["-y", "@alga-psa/mcp-connector"],
      "env": {
        "ALGA_INSTANCE_URL": "https://alga.example.com",
        "ALGA_API_TOKEN": "your-api-key"
      }
    }
  }
}
```

## Local development

```bash
ALGA_INSTANCE_URL=https://alga.example.com ALGA_API_TOKEN=key npm run dev -w @alga-psa/mcp-connector
npm run build -w @alga-psa/mcp-connector   # bundles to dist/index.js (npx entry)
npm test  -w @alga-psa/mcp-connector
```

Diagnostics are written to **stderr**; **stdout** carries the MCP JSON-RPC stream.
