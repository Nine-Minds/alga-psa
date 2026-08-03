/**
 * Hosted platform providers (EE): which shared Microsoft/Google apps are
 * available for zero-config agent provisioning. Loaded via the @product/mcp seam.
 */

import { editionGateResponse } from '@/lib/editionGating/response';
import { NextRequest, NextResponse } from 'next/server';
import { isEnterpriseEdition } from '@/lib/features';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!isEnterpriseEdition()) return editionGateResponse('mcp');
  const { authenticateMcpAdmin, listPlatformProviders } = await import('@product/mcp/entry');
  const admin = await authenticateMcpAdmin(req);
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  return NextResponse.json({ data: await listPlatformProviders(admin.tenant) });
}
