import { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import jwt from 'jsonwebtoken';
import { getCurrentUser } from '@alga-psa/auth';
import { getTicketById } from '@alga-psa/tickets/actions';
import { getHocuspocusJwtSecret } from '@/lib/hocuspocusJwt';

const LIVE_TOKEN_TTL_SECONDS = 5 * 60;

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await getCurrentUser();
    if (!user?.tenant || !user.user_id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id: ticketId } = await params;
    if (!ticketId) {
      return NextResponse.json({ error: 'Ticket ID is required' }, { status: 400 });
    }

    await getTicketById(ticketId);

    const secret = await getHocuspocusJwtSecret();
    const token = jwt.sign(
      {
        tenantId: user.tenant,
        userId: user.user_id,
        ticketId,
      },
      secret,
      {
        expiresIn: LIVE_TOKEN_TTL_SECONDS,
        jwtid: randomUUID(),
      }
    );

    return NextResponse.json({ token });
  } catch (error) {
    if (error instanceof Error) {
      if (error.message.includes('Permission denied')) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }

      if (error.message.includes('not found')) {
        return NextResponse.json({ error: 'Ticket not found' }, { status: 404 });
      }
    }

    console.error('[ticket live-token] Failed to issue ticket live token:', error);
    return NextResponse.json({ error: 'Failed to issue live token' }, { status: 500 });
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
