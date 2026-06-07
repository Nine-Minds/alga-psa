/**
 * MCP agent-action audit export (EE, Phase 2 F033). Returns recorded agent tool
 * invocations for the tenant, optionally filtered by agentId.
 */
import { NextRequest, NextResponse } from 'next/server';
import { isEnterpriseEdition } from '@/lib/features';
import { authenticateMcpAdmin } from '@/lib/mcp/adminAuth';
import { exportAgentAudit } from '@/lib/mcp/agentAudit';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!isEnterpriseEdition()) return NextResponse.json({ error: 'Enterprise feature' }, { status: 404 });
  const admin = await authenticateMcpAdmin(req);
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const agentId = req.nextUrl.searchParams.get('agentId') ?? undefined;
  const limitParam = req.nextUrl.searchParams.get('limit');
  const limit = limitParam ? Number(limitParam) : undefined;
  const rows = await exportAgentAudit(admin.tenant, { agentId, limit });
  return NextResponse.json({ data: rows, count: rows.length });
}
