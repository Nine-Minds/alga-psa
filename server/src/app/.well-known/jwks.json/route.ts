/**
 * JWKS for AlgaPSA-issued MCP access tokens (EE). Publishes the AS signing
 * public keys so the resource server (and conformant introspectors) can verify.
 * Implementation loaded via the @product/mcp seam.
 */
import { NextRequest, NextResponse } from 'next/server';
import { isEnterpriseEdition } from '@/lib/features';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const NO_STORE = { 'Cache-Control': 'no-store, max-age=0' } as const;

export async function GET(_req: NextRequest): Promise<NextResponse> {
  if (!isEnterpriseEdition()) {
    return NextResponse.json({ error: 'Not found' }, { status: 404, headers: NO_STORE });
  }
  const { getPublicJwks, isAuthServerEnabled } = await import('@product/mcp/entry');
  if (!(await isAuthServerEnabled())) {
    return NextResponse.json({ error: 'Not found' }, { status: 404, headers: NO_STORE });
  }
  return NextResponse.json(await getPublicJwks(), { headers: NO_STORE });
}
