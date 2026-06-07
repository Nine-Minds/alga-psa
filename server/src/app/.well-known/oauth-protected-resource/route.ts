/**
 * OAuth 2.0 Protected Resource Metadata (RFC 9728) for the MCP resource.
 * MCP clients fetch this (advertised via the 401 WWW-Authenticate header) to
 * discover which authorization servers (tenant IdPs) issue tokens for /api/mcp.
 */
import { NextRequest, NextResponse } from 'next/server';
import { isEnterpriseEdition } from '@/lib/features';
import { listAllActiveIssuers } from '@/lib/mcp/agents';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!isEnterpriseEdition()) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  let issuers: string[] = [];
  try {
    issuers = await listAllActiveIssuers();
  } catch {
    issuers = [];
  }
  return NextResponse.json({
    resource: `${req.nextUrl.origin}/api/mcp`,
    authorization_servers: issuers,
    bearer_methods_supported: ['header'],
    scopes_supported: [],
  });
}
