/**
 * Session Management API
 *
 * GET /api/auth/sessions - Get current user's active sessions
 * DELETE /api/auth/sessions - Revoke all other sessions (except current)
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  getUserSessionsAction,
  revokeAllOtherSessionsAction,
  type RevokeAllSessionsParams
} from 'server/src/lib/actions/session-actions/sessionActions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/auth/sessions
 * Get current user's active sessions
 */
export async function GET(request: NextRequest) {
  try {
    const data = await getUserSessionsAction();
    return NextResponse.json(data);
  } catch (error) {
    console.error('[GET /api/auth/sessions] Error:', error);
    const message = error instanceof Error ? error.message : 'Internal server error';
    const status = message.includes('Unauthorized') ? 401 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

/**
 * DELETE /api/auth/sessions
 * Revoke all other sessions (except current)
 */
export async function DELETE(request: NextRequest) {
  try {
    let params: RevokeAllSessionsParams | undefined;

    // Try to parse request body for 2FA code
    try {
      const body = await request.json();
      params = body;
    } catch (e) {
      // No body or invalid JSON - that's OK
    }

    const result = await revokeAllOtherSessionsAction(params);

    if (result.requires_2fa) {
      return NextResponse.json(
        { error: '2FA verification required', requires_2fa: true },
        { status: 403 }
      );
    }

    if (!result.success) {
      return NextResponse.json(
        { error: result.message },
        { status: 400 }
      );
    }

    return NextResponse.json(result);
  } catch (error) {
    console.error('[DELETE /api/auth/sessions] Error:', error);
    const message = error instanceof Error ? error.message : 'Internal server error';
    const status = message.includes('Unauthorized') ? 401 :
                   message.includes('Invalid 2FA') ? 403 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
