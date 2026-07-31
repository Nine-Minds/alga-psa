import { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { decode } from '@auth/core/jwt';
import jwt from 'jsonwebtoken';
import { getCurrentUser, getNextAuthSecret, getSessionCookieName } from '@alga-psa/auth';
import { getUserWithRoles } from '@alga-psa/db';
import { getTicketById } from '@alga-psa/tickets/actions/ticketActions';
import { auth } from '../../../auth/[...nextauth]/auth';
import { getHocuspocusJwtSecret } from '@/lib/hocuspocusJwt';

const LIVE_TOKEN_TTL_SECONDS = 5 * 60;

function getTicketActionError(value: unknown): { message: string; status: 403 | 404 | 400 } | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const candidate = value as { actionError?: unknown; permissionError?: unknown };
  if (typeof candidate.permissionError === 'string') {
    return { message: 'Forbidden', status: 403 };
  }
  if (typeof candidate.actionError === 'string') {
    const status = candidate.actionError.toLowerCase().includes('not found') ? 404 : 400;
    return { message: candidate.actionError, status };
  }
  return null;
}

async function decodeSessionUserFromRequest(request: NextRequest): Promise<{ id?: string; tenant?: string } | null> {
  const requestCookies = request.cookies;
  if (!requestCookies) {
    return null;
  }

  const primaryCookieName = getSessionCookieName();
  const cookieCandidates = Array.from(new Set([
    primaryCookieName,
    'authjs.session-token',
    '__Secure-authjs.session-token',
    'next-auth.session-token',
    '__Secure-next-auth.session-token',
  ]));

  const secret = await getNextAuthSecret();

  for (const candidate of cookieCandidates) {
    const token = requestCookies.get(candidate)?.value;
    if (!token) {
      continue;
    }

    try {
      const decoded = await decode({
        token,
        secret,
        salt: candidate,
      });

      if (decoded?.id || decoded?.tenant) {
        return {
          id: typeof decoded.id === 'string' ? decoded.id : undefined,
          tenant: typeof decoded.tenant === 'string' ? decoded.tenant : undefined,
        };
      }
    } catch {
      continue;
    }
  }

  return null;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await auth();
    const sessionUser = session?.user as { id?: string; tenant?: string } | undefined;

    let tenantId = sessionUser?.tenant ?? null;
    let userId = sessionUser?.id ?? null;

    if (sessionUser?.id && sessionUser.tenant) {
      const sessionBackedUser = await getUserWithRoles(sessionUser.id, sessionUser.tenant);
      tenantId = sessionBackedUser?.tenant ?? sessionUser.tenant;
      userId = sessionBackedUser?.user_id ?? sessionUser.id;
    }

    if (!tenantId || !userId) {
      const decodedSessionUser = await decodeSessionUserFromRequest(request);
      tenantId = decodedSessionUser?.tenant ?? null;
      userId = decodedSessionUser?.id ?? null;
    }

    if (!tenantId || !userId) {
      const currentUser = await getCurrentUser().catch(() => null);
      tenantId = currentUser?.tenant ?? null;
      userId = currentUser?.user_id ?? null;
    }

    if (!tenantId || !userId) {
      console.warn('[ticket live-token] Unauthorized request: missing auth context', {
        hasSession: Boolean(session),
        sessionUserId: sessionUser?.id ?? null,
        sessionTenant: sessionUser?.tenant ?? null,
      });
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id: ticketId } = await params;
    if (!ticketId) {
      return NextResponse.json({ error: 'Ticket ID is required' }, { status: 400 });
    }

    const ticketResult = await getTicketById(ticketId);
    const ticketError = getTicketActionError(ticketResult);
    if (ticketError) {
      return NextResponse.json({ error: ticketError.message }, { status: ticketError.status });
    }

    const secret = await getHocuspocusJwtSecret();
    const token = jwt.sign(
      {
        tenantId,
        userId,
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
