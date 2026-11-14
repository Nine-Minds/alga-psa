/**
 * IdP setup suggestions (EE, F008): if the tenant already linked Microsoft, we
 * know their Entra tenant id and can pre-fill the agent IdP. Also returns the
 * canonical MCP resource URL, the audience the form suggests for Google/Custom.
 * Loaded via the seam.
 */

import { editionGateResponse } from '@/lib/editionGating/response';
import { NextRequest, NextResponse } from 'next/server';
import { isEnterpriseEdition } from '@/lib/features';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!isEnterpriseEdition()) return editionGateResponse('mcp');
  const { authenticateMcpAdmin, getIdpSuggestions, resolvePublicBaseUrl, mcpResource } = await import('@product/mcp/entry');
  const admin = await authenticateMcpAdmin(req);
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const [suggestions, base] = await Promise.all([getIdpSuggestions(admin.tenant), resolvePublicBaseUrl(req)]);
  return NextResponse.json({ data: { ...suggestions, mcpResource: mcpResource(base) } });
}
