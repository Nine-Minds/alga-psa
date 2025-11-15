/**
 * Individual Session Management API
 *
 * DELETE /api/auth/sessions/[sessionId] - Revoke a specific session
 */

import { NextRequest, NextResponse } from 'next/server';
import { auth } from 'server/src/app/api/auth/[...nextauth]/edge-auth';
import { UserSession } from 'server/src/lib/models/UserSession';

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
    const session = await auth();

    if (!session?.user?.id || !session?.user?.tenant) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const { sessionId } = params;

    // Verify the session belongs to the current user
    const targetSession = await UserSession.findById(
      session.user.tenant,
      sessionId
    );

    if (!targetSession) {
      return NextResponse.json(
        { error: 'Session not found' },
        { status: 404 }
      );
    }

    if (targetSession.user_id !== session.user.id) {
      return NextResponse.json(
        { error: 'Forbidden - This session does not belong to you' },
        { status: 403 }
      );
    }

    // Check if this is the current session
    const currentSessionId = (session as any).session_id;
    const isCurrentSession = sessionId === currentSessionId;

    // Revoke the session
    await UserSession.revokeSession(
      session.user.tenant,
      sessionId,
      'user_logout'
    );

    return NextResponse.json({
      success: true,
      is_current: isCurrentSession,
      message: isCurrentSession
        ? 'Current session revoked - you will be logged out'
        : 'Session revoked successfully',
    });
  } catch (error) {
    console.error('[DELETE /api/auth/sessions/:sessionId] Error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
