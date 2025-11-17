/**
 * Individual Session Management API
 *
 * DELETE /api/auth/sessions/[sessionId] - Revoke a specific session
 */

import { NextRequest, NextResponse } from 'next/server';
import { revokeSessionAction } from 'server/src/lib/actions/session-actions/sessionActions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RouteParams {
  params: {
    sessionId: string;
  };
}

/**
 * DELETE /api/auth/sessions/[sessionId]
 * Revoke a specific session by ID
 */
export async function DELETE(
  request: NextRequest,
  { params }: RouteParams
) {
  try {
    const { sessionId } = params;
    const result = await revokeSessionAction(sessionId);
    return NextResponse.json(result);
  } catch (error) {
    console.error('[DELETE /api/auth/sessions/:sessionId] Error:', error);
    const message = error instanceof Error ? error.message : 'Internal server error';
    const status = message.includes('Unauthorized') ? 401 :
                   message.includes('Forbidden') || message.includes('not belong') ? 403 :
                   message.includes('not found') ? 404 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
