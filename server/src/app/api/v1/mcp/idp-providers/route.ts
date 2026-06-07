/**
 * MCP trusted IdP providers (EE). Implementation loaded via the @product/mcp seam.
 */
import { NextRequest, NextResponse } from 'next/server';
import { isEnterpriseEdition } from '@/lib/features';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!isEnterpriseEdition()) return NextResponse.json({ error: 'Enterprise feature' }, { status: 404 });
  const { authenticateMcpAdmin, listTrustedIdps } = await import('@product/mcp/entry');
  const admin = await authenticateMcpAdmin(req);
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  return NextResponse.json({ data: await listTrustedIdps(admin.tenant) });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!isEnterpriseEdition()) return NextResponse.json({ error: 'Enterprise feature' }, { status: 404 });
  const { authenticateMcpAdmin, addTrustedIdp } = await import('@product/mcp/entry');
  const admin = await authenticateMcpAdmin(req);
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as {
    kind?: 'google' | 'microsoft' | 'custom';
    entraTenantId?: string;
    issuer?: string;
    jwksUri?: string;
    audience?: string;
    subjectClaim?: string;
  };
  const kind = body.kind ?? 'custom';
  if (kind === 'microsoft' && !body.entraTenantId) {
    return NextResponse.json({ error: 'The Microsoft preset requires "entraTenantId".' }, { status: 400 });
  }
  if (kind === 'custom' && (!body.issuer || !body.jwksUri)) {
    return NextResponse.json({ error: 'A custom IdP requires "issuer" and "jwksUri".' }, { status: 400 });
  }
  try {
    const idp = await addTrustedIdp({
      tenant: admin.tenant,
      kind,
      entraTenantId: body.entraTenantId,
      issuer: body.issuer,
      jwksUri: body.jwksUri,
      audience: body.audience,
      subjectClaim: body.subjectClaim,
    });
    return NextResponse.json({ data: idp }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Failed to add IdP' }, { status: 400 });
  }
}
