export interface ConnectorConfig {
  /** Base URL of the AlgaPSA instance, no trailing slash. */
  instanceUrl: string;
  /** AlgaPSA API key (sent as x-api-key). */
  apiToken: string;
  /** Optional tenant id, sent as x-tenant-id when present. */
  tenantId?: string;
  registryPath: string;
  searchPath: string;
  requestTimeoutMs: number;
}

/**
 * Load + validate connector configuration from the environment. Fails fast
 * (per repo standards) with an actionable message when required vars are
 * missing or malformed — the MCP client surfaces this on stderr.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): ConnectorConfig {
  const instanceUrl = (env.ALGA_INSTANCE_URL ?? '').trim();
  const apiToken = (env.ALGA_API_TOKEN ?? '').trim();

  const missing: string[] = [];
  if (!instanceUrl) missing.push('ALGA_INSTANCE_URL');
  if (!apiToken) missing.push('ALGA_API_TOKEN');
  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variable(s): ${missing.join(', ')}. ` +
        'Set ALGA_INSTANCE_URL (e.g. https://alga.example.com) and ALGA_API_TOKEN ' +
        '(an AlgaPSA API key) in your MCP client configuration.',
    );
  }

  let normalizedBase: string;
  try {
    normalizedBase = new URL(instanceUrl).toString().replace(/\/$/, '');
  } catch {
    throw new Error(`ALGA_INSTANCE_URL is not a valid URL: "${instanceUrl}".`);
  }

  const timeoutRaw = Number(env.ALGA_REQUEST_TIMEOUT_MS ?? '30000');
  const requestTimeoutMs = Number.isFinite(timeoutRaw) && timeoutRaw > 0 ? timeoutRaw : 30000;

  return {
    instanceUrl: normalizedBase,
    apiToken,
    tenantId: (env.ALGA_TENANT_ID ?? '').trim() || undefined,
    registryPath: (env.ALGA_REGISTRY_PATH ?? '/api/v1/meta/mcp-registry').trim(),
    searchPath: (env.ALGA_SEARCH_PATH ?? '/api/v1/search').trim(),
    requestTimeoutMs,
  };
}
