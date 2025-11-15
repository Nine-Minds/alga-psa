/**
 * Session Management API
 *
 * GET /api/auth/sessions - List active sessions for current user
 * DELETE /api/auth/sessions - Revoke all sessions except current one
 */

import { NextRequest, NextResponse } from 'next/server';
import { auth } from 'server/src/app/api/auth/[...nextauth]/edge-auth';
import { UserSession } from 'server/src/lib/models/UserSession';
import { verifyTwoFactorCode, isTwoFactorEnabled } from 'server/src/lib/auth/twoFactorHelpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/auth/sessions
 * List all active sessions for the current user
 */
export async function GET(request: NextRequest) {
  try {
    const session = await auth();

    if (!session?.user?.id || !session?.user?.tenant) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const sessions = await UserSession.getUserSessions(
      session.user.tenant,
      session.user.id
    );

    // Add "is_current" flag to each session
    const sessionsWithCurrent = sessions.map((s) => ({
      ...s,
      is_current: s.session_id === (session as any).session_id,
    }));

    return NextResponse.json({
      sessions: sessionsWithCurrent,
      total: sessionsWithCurrent.length,
    });
  } catch (error) {
    console.error('[GET /api/auth/sessions] Error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/auth/sessions
 * Revoke all sessions except the current one (logout from other devices)
 *
 * Request body (if 2FA enabled):
 * {
 *   "two_factor_code": "123456"
 * }
 */
export async function DELETE(request: NextRequest) {
  try {
    const session = await auth();

    if (!session?.user?.id || !session?.user?.tenant) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const currentSessionId = (session as any).session_id;

    if (!currentSessionId) {
      return NextResponse.json(
        { error: 'No active session found' },
        { status: 400 }
      );
    }

    // Check if user has 2FA enabled
    const has2FA = await isTwoFactorEnabled(session.user.tenant, session.user.id);

    if (has2FA) {
      // Parse request body
      let body;
      try {
        body = await request.json();
      } catch (e) {
        return NextResponse.json(
          { error: '2FA verification required', requires_2fa: true },
          { status: 403 }
        );
      }

      const twoFactorCode = body?.two_factor_code;

      if (!twoFactorCode) {
        return NextResponse.json(
          { error: '2FA verification required', requires_2fa: true },
          { status: 403 }
        );
      }

      // Verify 2FA code
      const isValid = await verifyTwoFactorCode(
        session.user.tenant,
        session.user.id,
        twoFactorCode
      );

      if (!isValid) {
        return NextResponse.json(
          { error: 'Invalid 2FA code', requires_2fa: true },
          { status: 403 }
        );
      }
    }

    // Proceed with revoking all other sessions
    const revokedCount = await UserSession.revokeAllExcept(
      session.user.tenant,
      session.user.id,
      currentSessionId
    );

    return NextResponse.json({
      success: true,
      revoked_count: revokedCount,
      message: `Logged out from ${revokedCount} other device(s)`,
    });
  } catch (error) {
    console.error('[DELETE /api/auth/sessions] Error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
