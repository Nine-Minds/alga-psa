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
  const pageParam = Number(req.nextUrl.searchParams.get('page') ?? '1');
  const pageSizeParam = Number(req.nextUrl.searchParams.get('pageSize') ?? '25');
  const page = Number.isFinite(pageParam) && pageParam > 0 ? Math.floor(pageParam) : 1;
  const pageSize = Number.isFinite(pageSizeParam) ? Math.min(Math.max(Math.floor(pageSizeParam), 1), 200) : 25;
  const { rows, total } = await exportAgentAudit(admin.tenant, {
    agentId,
    limit: pageSize,
    offset: (page - 1) * pageSize,
  });
  return NextResponse.json({ data: rows, total, page, pageSize });
}
