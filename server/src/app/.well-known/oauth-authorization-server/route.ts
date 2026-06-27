/**
 * OAuth 2.0 Authorization Server Metadata (RFC 8414) for the MCP AS (EE).
 * Implementation loaded via the @product/mcp seam.
 */
import { NextRequest, NextResponse } from 'next/server';
import { isEnterpriseEdition } from '@/lib/features';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Discovery doc is env-dependent and must never be CDN-cached (see the PRM route).
const NO_STORE = { 'Cache-Control': 'no-store, max-age=0' } as const;

export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!isEnterpriseEdition()) {
    return NextResponse.json({ error: 'Not found' }, { status: 404, headers: NO_STORE });
  }
  const { buildAuthServerMetadata, resolvePublicBaseUrl, isAuthServerEnabled } = await import('@product/mcp/entry');
  if (!(await isAuthServerEnabled())) {
    return NextResponse.json({ error: 'Not found' }, { status: 404, headers: NO_STORE });
  }
  const base = await resolvePublicBaseUrl(req);
  return NextResponse.json(buildAuthServerMetadata(base), { headers: NO_STORE });
}
