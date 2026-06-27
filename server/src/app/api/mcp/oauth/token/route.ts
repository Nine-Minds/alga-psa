/**
 * MCP OAuth Token endpoint (EE). authorization_code (PKCE) + refresh_token grants.
 * Logic via the @product/mcp seam.
 */
import { NextRequest, NextResponse } from 'next/server';
import { isEnterpriseEdition } from '@/lib/features';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const NO_STORE = { 'Cache-Control': 'no-store, max-age=0' };

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!isEnterpriseEdition()) {
    return NextResponse.json({ error: 'invalid_request' }, { status: 404, headers: NO_STORE });
  }
  const { handleToken, resolvePublicBaseUrl, isAuthServerEnabled } = await import('@product/mcp/entry');
  if (!(await isAuthServerEnabled())) {
    return NextResponse.json({ error: 'invalid_request' }, { status: 404, headers: NO_STORE });
  }
  const base = await resolvePublicBaseUrl(req);

  let form: URLSearchParams;
  try {
    form = new URLSearchParams(await req.text());
  } catch {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400, headers: NO_STORE });
  }

  const result = await handleToken(base, form);
  return NextResponse.json(result.body, { status: result.status, headers: NO_STORE });
}
