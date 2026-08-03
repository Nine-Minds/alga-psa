/**
 * Remote MCP server endpoint (Streamable HTTP, JSON-RPC over POST).
 * Enterprise-only: the implementation lives in ee/ and is loaded via the
 * @product/mcp seam (CE builds get the 404 stub).
 */
import { NextRequest, NextResponse } from 'next/server';
import { isEnterpriseEdition } from '@/lib/features';
import { editionGateResponse } from '@/lib/editionGating/response';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: NextRequest): Promise<Response> {
  if (!isEnterpriseEdition()) {
    return editionGateResponse('mcp');
  }
  const { handleMcpJsonRpc } = await import('@product/mcp/entry');
  return handleMcpJsonRpc(req);
}

// Streamable HTTP optionally uses GET for a server→client SSE stream; not needed here.
export async function GET(): Promise<NextResponse> {
  return NextResponse.json({ error: 'Method Not Allowed' }, { status: 405 });
}
