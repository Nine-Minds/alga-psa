/**
 * MCP agent provisioning (EE). Implementation loaded via the @product/mcp seam.
 */
import { NextRequest, NextResponse } from 'next/server';
import { isEnterpriseEdition } from '@/lib/features';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!isEnterpriseEdition()) return NextResponse.json({ error: 'Enterprise feature' }, { status: 404 });
  const { authenticateMcpAdmin, listAgents } = await import('@product/mcp/entry');
  const admin = await authenticateMcpAdmin(req);
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  return NextResponse.json({ data: await listAgents(admin.tenant) });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!isEnterpriseEdition()) return NextResponse.json({ error: 'Enterprise feature' }, { status: 404 });
  const { authenticateMcpAdmin, createAgent } = await import('@product/mcp/entry');
  const admin = await authenticateMcpAdmin(req);
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as {
    name?: string;
    description?: string;
    idpIssuer?: string;
    idpSubject?: string;
    roleIds?: string[];
  };
  if (!body.name) return NextResponse.json({ error: '"name" is required' }, { status: 400 });

  const agent = await createAgent({
    tenant: admin.tenant,
    name: body.name,
    description: body.description,
    idpIssuer: body.idpIssuer,
    idpSubject: body.idpSubject,
    roleIds: body.roleIds,
    createdBy: admin.userId ?? undefined,
  });
  return NextResponse.json({ data: agent }, { status: 201 });
}
