/**
 * OAuth 2.0 Authorization Server Metadata (RFC 8414) for the MCP AS (EE).
 * Implementation loaded via the @product/mcp seam.
 */
import { NextRequest, NextResponse } from 'next/server';
import { isEnterpriseEdition } from '@/lib/features';
import { editionGateResponse } from '@/lib/editionGating/response';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Discovery doc is env-dependent and must never be CDN-cached (see the PRM route).
const NO_STORE = { 'Cache-Control': 'no-store, max-age=0' } as const;

export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!isEnterpriseEdition()) {
    return editionGateResponse('mcp', { headers: NO_STORE });
  }
  const { buildAuthServerMetadata, resolvePublicBaseUrl } = await import('@product/mcp/entry');
  const base = await resolvePublicBaseUrl(req);
  return NextResponse.json(buildAuthServerMetadata(base), { headers: NO_STORE });
}
