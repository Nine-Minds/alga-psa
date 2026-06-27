import { getSecretProviderInstance } from '@alga-psa/core/secrets';

/**
 * Dark-release switch for the MCP Authorization Server. When disabled (the
 * default), the AS endpoints 404 and the Protected Resource Metadata keeps
 * advertising the legacy trusted IdPs — so this whole feature can ship off and be
 * flipped on per environment without changing what existing clients discover.
 *
 * Instance-level (not a per-user PostHog flag) because the AS + discovery
 * endpoints are unauthenticated and consumed by external OAuth clients.
 */
function truthy(v: string | undefined | null): boolean {
  return v === 'true' || v === '1' || v === 'yes';
}

export async function isAuthServerEnabled(): Promise<boolean> {
  if (truthy(process.env.MCP_AUTH_SERVER_ENABLED)) return true;
  try {
    const sp = await getSecretProviderInstance();
    return truthy(await sp.getAppSecret('MCP_AUTH_SERVER_ENABLED'));
  } catch {
    return false;
  }
}
