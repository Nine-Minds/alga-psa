/**
 * IdP setup suggestions (EE, F008): if the tenant already linked Microsoft, we
 * know their Entra tenant id and can pre-fill the agent IdP. Loaded via the seam.
 */
import { NextRequest, NextResponse } from 'next/server';
import { isEnterpriseEdition } from '@/lib/features';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!isEnterpriseEdition()) return NextResponse.json({ error: 'Enterprise feature' }, { status: 404 });
  const { authenticateMcpAdmin, getIdpSuggestions } = await import('@product/mcp/entry');
  const admin = await authenticateMcpAdmin(req);
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  return NextResponse.json({ data: await getIdpSuggestions(admin.tenant) });
}
