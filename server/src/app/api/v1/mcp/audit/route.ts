/**
 * MCP agent-action audit export (EE). Implementation loaded via the @product/mcp seam.
 */
import { NextRequest, NextResponse } from 'next/server';
import { isEnterpriseEdition } from '@/lib/features';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!isEnterpriseEdition()) return NextResponse.json({ error: 'Enterprise feature' }, { status: 404 });
  const { authenticateMcpAdmin, exportAgentAudit } = await import('@product/mcp/entry');
  const admin = await authenticateMcpAdmin(req);
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const agentId = req.nextUrl.searchParams.get('agentId') ?? undefined;
  const limitParam = req.nextUrl.searchParams.get('limit');
  const limit = limitParam ? Number(limitParam) : undefined;
  const rows = await exportAgentAudit(admin.tenant, { agentId, limit });
  return NextResponse.json({ data: rows, count: rows.length });
}
