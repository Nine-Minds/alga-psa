/**
 * OAuth 2.0 Protected Resource Metadata (RFC 9728) for the MCP resource (EE).
 * AlgaPSA is its own authorization server for MCP (CIMD + PKCE), so it advertises
 * itself. Implementation loaded via the @product/mcp seam.
 */
import { NextRequest, NextResponse } from 'next/server';
import { isEnterpriseEdition } from '@/lib/features';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// This doc is env-dependent and `force-dynamic` only governs Next's rendering, not
// the CDN. Without an explicit directive a fronting CDN (CloudFront) caches GETs
// under its default TTL, which once pinned a stale internal-origin response for
// ~24h. `no-store` keeps OAuth discovery fresh everywhere (PR #2801).
const NO_STORE = { 'Cache-Control': 'no-store, max-age=0' } as const;

export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!isEnterpriseEdition()) {
    return NextResponse.json({ error: 'Not found' }, { status: 404, headers: NO_STORE });
  }
  const { resolvePublicBaseUrl } = await import('@product/mcp/entry');
  // External clients (e.g. claude.ai) read this, so it must be the public origin.
  const baseUrl = await resolvePublicBaseUrl(req);
  return NextResponse.json(
    {
      resource: `${baseUrl}/api/mcp`,
      authorization_servers: [baseUrl],
      bearer_methods_supported: ['header'],
      scopes_supported: ['mcp'],
    },
    { headers: NO_STORE },
  );
}
