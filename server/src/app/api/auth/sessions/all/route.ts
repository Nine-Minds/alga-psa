/**
 * Admin Session Management API
 *
 * GET /api/auth/sessions/all - Get all users' active sessions (admin only)
 */

import { NextRequest, NextResponse } from 'next/server';
import { getAllSessionsAction } from '@alga-psa/auth/actions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function allSessionsRouteError(error: unknown): { status: number; message: string } {
  const message = error instanceof Error ? error.message : '';
  if (message.includes('Unauthorized')) {
    return { status: 401, message: 'Unauthorized' };
  }
  if (message.includes('Forbidden')) {
    return { status: 403, message: 'You do not have permission to view all sessions' };
  }
  return { status: 500, message: 'Failed to load sessions' };
}

/**
 * GET /api/auth/sessions/all
 * Get all users' active sessions (admin only)
 */
export async function GET(request: NextRequest) {
  try {
    const data = await getAllSessionsAction();
    if ('permissionError' in data) {
      return NextResponse.json(
        { error: data.permissionError },
        { status: 403 }
      );
    }
    return NextResponse.json(data);
  } catch (error) {
    console.error('[GET /api/auth/sessions/all] Error:', error);
    const { status, message } = allSessionsRouteError(error);
    return NextResponse.json({ error: message }, { status });
  }
}
