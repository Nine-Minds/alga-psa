/**
 * Admin Session Management API
 *
 * GET /api/auth/sessions/all - Get all users' active sessions (admin only)
 */

import { NextRequest, NextResponse } from 'next/server';
import { getAllSessionsAction } from '@alga-psa/auth/actions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/auth/sessions/all
 * Get all users' active sessions (admin only)
 */
export async function GET(request: NextRequest) {
  try {
    const data = await getAllSessionsAction();
    return NextResponse.json(data);
  } catch (error) {
    console.error('[GET /api/auth/sessions/all] Error:', error);
    const message = error instanceof Error ? error.message : 'Internal server error';
    const status = message.includes('Unauthorized') ? 401 :
                   message.includes('Forbidden') ? 403 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
