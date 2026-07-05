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

  try {
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
  } catch (e) {
    // Duplicate (issuer, subject) binding -> 409 with the friendly message.
    if (e instanceof Error && e.name === 'AgentBindingConflictError') {
      return NextResponse.json({ error: e.message }, { status: 409 });
    }
    throw e;
  }
}

// Toggle an agent's active flag (the reversible soft-disable).
export async function PATCH(req: NextRequest): Promise<NextResponse> {
  if (!isEnterpriseEdition()) return NextResponse.json({ error: 'Enterprise feature' }, { status: 404 });
  const { authenticateMcpAdmin, setAgentActive } = await import('@product/mcp/entry');
  const admin = await authenticateMcpAdmin(req);
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as { agentId?: string; active?: boolean };
  if (!body.agentId || typeof body.active !== 'boolean') {
    return NextResponse.json({ error: '"agentId" and a boolean "active" are required.' }, { status: 400 });
  }
  await setAgentActive(admin.tenant, body.agentId, body.active);
  return NextResponse.json({ ok: true });
}

// Permanently remove an agent (irreversible — tears down roles, audit, backing user).
export async function DELETE(req: NextRequest): Promise<NextResponse> {
  if (!isEnterpriseEdition()) return NextResponse.json({ error: 'Enterprise feature' }, { status: 404 });
  const { authenticateMcpAdmin, deleteAgent } = await import('@product/mcp/entry');
  const admin = await authenticateMcpAdmin(req);
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const agentId = req.nextUrl.searchParams.get('agentId');
  if (!agentId) return NextResponse.json({ error: '"agentId" is required.' }, { status: 400 });
  await deleteAgent(admin.tenant, agentId);
  return NextResponse.json({ ok: true });
}
