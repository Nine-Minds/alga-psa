/**
 * OAuth 2.0 Protected Resource Metadata (RFC 9728) for the MCP resource (EE).
 * Advertises AlgaPSA itself as the authorization server when the Alga MCP AS is
 * enabled; otherwise advertises the legacy trusted IdPs (dark-release safe).
 * Implementation loaded via the @product/mcp seam.
 */
import { NextRequest, NextResponse } from 'next/server';
import { isEnterpriseEdition } from '@/lib/features';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// This doc is env- and tenant-dependent and `force-dynamic` only governs Next's
// rendering, not the CDN. Without an explicit directive a fronting CDN (CloudFront)
// caches GETs under its default TTL, which once pinned a stale internal-origin
// response for ~24h. `no-store` keeps OAuth discovery fresh everywhere (PR #2801).
const NO_STORE = { 'Cache-Control': 'no-store, max-age=0' } as const;

export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!isEnterpriseEdition()) {
    return NextResponse.json({ error: 'Not found' }, { status: 404, headers: NO_STORE });
  }
  const { resolvePublicBaseUrl, isAuthServerEnabled, listAllActiveIssuers } = await import('@product/mcp/entry');
  // External clients (e.g. claude.ai) read this, so it must be the public origin.
  const baseUrl = await resolvePublicBaseUrl(req);

  // When the Alga AS is enabled, advertise Alga itself (CIMD + PKCE). Otherwise
  // fall back to the legacy trusted-IdP issuers so existing clients are unaffected
  // (dark-release safe — see MCP_AUTH_SERVER_ENABLED).
  const asEnabled = await isAuthServerEnabled();
  let authorizationServers: string[];
  let scopes: string[];
  if (asEnabled) {
    authorizationServers = [baseUrl];
    scopes = ['mcp'];
  } else {
    try {
      authorizationServers = await listAllActiveIssuers();
    } catch {
      authorizationServers = [];
    }
    scopes = [];
  }

  return NextResponse.json(
    {
      resource: `${baseUrl}/api/mcp`,
      authorization_servers: authorizationServers,
      bearer_methods_supported: ['header'],
      scopes_supported: scopes,
    },
    { headers: NO_STORE },
  );
}
