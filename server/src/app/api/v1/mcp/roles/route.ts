/**
 * Assignable MSP roles for agent provisioning (EE). Powers the role picker in
 * the admin UI. Implementation loaded via the @product/mcp seam.
 */

import { editionGateResponse } from '@/lib/editionGating/response';
import { NextRequest, NextResponse } from 'next/server';
import { isEnterpriseEdition } from '@/lib/features';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!isEnterpriseEdition()) return editionGateResponse('mcp');
  const { authenticateMcpAdmin, listAssignableRoles } = await import('@product/mcp/entry');
  const admin = await authenticateMcpAdmin(req);
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  return NextResponse.json({ data: await listAssignableRoles(admin.tenant) });
}
