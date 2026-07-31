/**
 * Individual Session Management API
 *
 * DELETE /api/auth/sessions/[sessionId] - Revoke a specific session
 */

import { NextRequest, NextResponse } from 'next/server';
import { revokeSessionAction } from '@alga-psa/auth/actions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RouteParams {
  params: {
    sessionId: string;
  };
}

function revokeSessionRouteError(error: unknown): { status: number; message: string } {
  const message = error instanceof Error ? error.message : '';
  if (message.includes('Unauthorized')) {
    return { status: 401, message: 'Unauthorized' };
  }
  if (message.includes('Forbidden') || message.includes('not belong')) {
    return { status: 403, message: 'You do not have permission to revoke this session' };
  }
  if (message.includes('not found')) {
    return { status: 404, message: 'Session not found' };
  }
  return { status: 500, message: 'Failed to revoke session' };
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
    if (!result.success) {
      const status = result.message.includes('Unauthorized')
        ? 401
        : result.message.includes('not found')
          ? 404
          : result.message.includes('permission')
            ? 403
            : 400;
      return NextResponse.json({ error: result.message }, { status });
    }
    return NextResponse.json(result);
  } catch (error) {
    console.error('[DELETE /api/auth/sessions/:sessionId] Error:', error);
    const { status, message } = revokeSessionRouteError(error);
    return NextResponse.json({ error: message }, { status });
  }
}
