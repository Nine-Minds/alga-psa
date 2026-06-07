/**
 * MCP trusted IdP providers (EE). Per-tenant list of OAuth issuers whose tokens
 * the MCP resource server will accept for agent authentication.
 */
import { NextRequest, NextResponse } from 'next/server';
import { isEnterpriseEdition } from '@/lib/features';
import { authenticateMcpAdmin } from '@/lib/mcp/adminAuth';
import { addTrustedIdp, listTrustedIdps } from '@/lib/mcp/agents';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!isEnterpriseEdition()) return NextResponse.json({ error: 'Enterprise feature' }, { status: 404 });
  const admin = await authenticateMcpAdmin(req);
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  return NextResponse.json({ data: await listTrustedIdps(admin.tenant) });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!isEnterpriseEdition()) return NextResponse.json({ error: 'Enterprise feature' }, { status: 404 });
  const admin = await authenticateMcpAdmin(req);
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as { issuer?: string; jwksUri?: string; audience?: string };
  if (!body.issuer || !body.jwksUri) {
    return NextResponse.json({ error: '"issuer" and "jwksUri" are required' }, { status: 400 });
  }
  await addTrustedIdp({ tenant: admin.tenant, issuer: body.issuer, jwksUri: body.jwksUri, audience: body.audience });
  return NextResponse.json({ data: { issuer: body.issuer, ok: true } }, { status: 201 });
}
