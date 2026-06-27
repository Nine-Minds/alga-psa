/**
 * OAuth 2.0 Protected Resource Metadata (RFC 9728) for the MCP resource (EE).
 * Implementation loaded via the @product/mcp seam.
 */
import { NextRequest, NextResponse } from 'next/server';
import { isEnterpriseEdition } from '@/lib/features';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// This doc is env- and tenant-dependent (public origin + active issuers), and
// `force-dynamic` only governs Next's rendering — not the CDN. Without an explicit
// directive a fronting CDN (CloudFront here) caches GETs under its default TTL,
// which pinned a stale internal-origin response for ~24h. `no-store` keeps OAuth
// discovery fresh everywhere instead of relying on per-distribution cache config.
const NO_STORE = { 'Cache-Control': 'no-store, max-age=0' } as const;

export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!isEnterpriseEdition()) {
    return NextResponse.json({ error: 'Not found' }, { status: 404, headers: NO_STORE });
  }
  const { listAllActiveIssuers, resolvePublicBaseUrl } = await import('@product/mcp/entry');
  let issuers: string[] = [];
  try {
    issuers = await listAllActiveIssuers();
  } catch {
    issuers = [];
  }
  // Public discovery doc — external clients (e.g. claude.ai) read this, so the
  // advertised resource must be the public origin, not the internal upstream one.
  const baseUrl = await resolvePublicBaseUrl(req);
  return NextResponse.json(
    {
      resource: `${baseUrl}/api/mcp`,
      authorization_servers: issuers,
      bearer_methods_supported: ['header'],
      scopes_supported: [],
    },
    { headers: NO_STORE },
  );
}
