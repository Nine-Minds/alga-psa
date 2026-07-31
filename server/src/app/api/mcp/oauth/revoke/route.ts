/**
 * MCP OAuth Token Revocation endpoint (RFC 7009, EE). Revokes the grant behind a
 * presented refresh token; always returns 200 (idempotent). Logic via the seam.
 */
import { NextRequest, NextResponse } from 'next/server';
import { isEnterpriseEdition } from '@/lib/features';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const NO_STORE = { 'Cache-Control': 'no-store, max-age=0' };

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!isEnterpriseEdition()) {
    return new NextResponse(null, { status: 404, headers: NO_STORE });
  }
  const { handleRevoke } = await import('@product/mcp/entry');
  let form: URLSearchParams;
  try {
    form = new URLSearchParams(await req.text());
  } catch {
    return new NextResponse(null, { status: 200, headers: NO_STORE });
  }
  await handleRevoke(form);
  return new NextResponse(null, { status: 200, headers: NO_STORE });
}
