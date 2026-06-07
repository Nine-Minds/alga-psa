/**
 * Remote MCP server endpoint (Streamable HTTP, JSON-RPC over POST).
 * Enterprise-gated. Exposes the same 3 progressive-disclosure meta-tools as the
 * local connector, dispatched server-side under the caller's identity.
 */

import { NextRequest, NextResponse } from 'next/server';
import { isEnterpriseEdition } from '@/lib/features';
import { handleMcpJsonRpc } from '@/lib/mcp/jsonRpcServer';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!isEnterpriseEdition()) {
    return NextResponse.json({ error: 'The remote MCP server is an Enterprise feature.' }, { status: 404 });
  }
  return handleMcpJsonRpc(req);
}

// Streamable HTTP optionally uses GET to open a server→client SSE stream; the
// request/response tool surface here does not need it.
export async function GET(): Promise<NextResponse> {
  return NextResponse.json({ error: 'Method Not Allowed' }, { status: 405 });
}
