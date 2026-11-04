import type { Session } from 'next-auth';

import logger from '@alga-psa/core/logger';
import { headers } from 'next/headers';
import { getSessionCookieName } from './session';

export async function logSessionRejection(reason: string): Promise<void> {
  let requestId = 'unavailable';
  try {
    const requestHeaders = await headers();
    const candidate = requestHeaders.get('x-request-id') || requestHeaders.get('x-correlation-id') || '';
    if (/^[A-Za-z0-9._:-]{1,128}$/.test(candidate)) requestId = candidate;
  } catch { /* Some auth callers run outside a Next request context. */ }
  logger.warn('[auth] session_rejected', { reason, requestId });
}
import { isInteractiveUserType } from '@alga-psa/types';
import { UserSession } from '@alga-psa/db/models/UserSession';
import { auth as edgeAuth } from '../nextauth/edge-auth';
import { auth as fullAuth } from '../nextauth/auth';

/**
 * Decoding a session cookie only proves the JWT is authentic; it says nothing
 * about whether the session is still alive or correctly stamped. Revocation
 * state and the session owner's canonical user type live in the database, so
 * every session handed to a caller is checked against them on every request
 * and fails closed:
 *
 * - a session with no tracked tenant/session identifier (e.g. an OAuth token
 *   minted before session tracking existed) is treated as revoked, and
 * - an unreachable sessions table is treated as revoked, and
 * - identity claims that disagree with the tracked user are rejected.
 *
 * This is the single gate for the edge-decoded path, which cannot query the
 * database itself, and the reason callers may authorize on any session this
 * module returns.
 */
async function requireLiveSession(session: Session | null): Promise<Session | null> {
  if (!session?.user) {
    let cookiePresent = false;
    try {
      const requestHeaders = await headers();
      const cookieHeader = requestHeaders.get('cookie') ?? '';
      cookiePresent = cookieHeader.split(';').some((cookie) => cookie.trim().startsWith(`${getSessionCookieName()}=`));
    } catch { /* Report the decode result without assuming request context. */ }
    await logSessionRejection(cookiePresent ? 'cookie_present_session_decode_or_expiry' : 'cookie_absent');
    return null;
  }

  const tenant = (session.user as { tenant?: unknown }).tenant;
  const userId = (session.user as { id?: unknown }).id;
  const userType = (session.user as { user_type?: unknown }).user_type;
  const sessionId = (session as { session_id?: unknown }).session_id;

  if (
    typeof tenant !== 'string'
    || tenant.length === 0
    || typeof userId !== 'string'
    || userId.length === 0
    || typeof userType !== 'string'
    || !isInteractiveUserType(userType)
    || typeof sessionId !== 'string'
    || sessionId.length === 0
  ) {
    await logSessionRejection('missing_identity_claims');
    return null;
  }

  try {
    const rejectionReason = await UserSession.getRejectionReason(tenant, sessionId, {
      userId,
      userType,
    });
    if (rejectionReason) {
      await logSessionRejection(`durable_session_${rejectionReason}`);
      return null;
    }
  } catch {
    await logSessionRejection('durable_session_lookup_unavailable');
    logger.error('[auth] Session revocation check failed closed');
    return null;
  }

  return session;
}

async function decodeSession(): Promise<Session | null> {
  let edgeSession: Session | null = null;
  try {
    edgeSession = await edgeAuth();
  } catch {
    await logSessionRejection('edge_session_decode_failed');
  }
  if (edgeSession) return edgeSession;

  // Edge auth can legitimately return null (or fail) in dev / after hot reloads.
  // Fall back to the full Node.js helper which is more tolerant.
  try {
    return await fullAuth();
  } catch {
    await logSessionRejection('full_session_decode_failed');
    return null;
  }
}

/**
 * Returns the current session, decoded on the edge-safe Auth.js instance when
 * possible, after confirming it has not been revoked.
 */
export async function getSession(): Promise<Session | null> {
  return requireLiveSession(await decodeSession());
}

/**
 * Returns the current session using the full Node.js Auth.js instance, which
 * additionally refreshes plan/tier claims and slides the session expiry.
 *
 * Use this in layouts and critical auth paths that need those refreshed claims.
 * Revocation is enforced identically by both helpers.
 */
export async function getSessionWithRevocationCheck(): Promise<Session | null> {
  return requireLiveSession(await decodeSessionWithFullAuthFirst());
}

async function decodeSessionWithFullAuthFirst(): Promise<Session | null> {
  try {
    const session = await fullAuth();
    if (session) {
      return session;
    }

    // Dev-only: Next.js dev + HMR can cause transient session decode failures in the Node auth path.
    // Try the edge-safe decoder as a fallback to avoid "logged out" UX during rebuilds.
    if (process.env.NODE_ENV !== 'production') {
      try {
        return await edgeAuth();
      } catch {
        await logSessionRejection('edge_session_decode_failed');
      }
    }

    return null;
  } catch {
    await logSessionRejection('full_session_decode_failed');
    if (process.env.NODE_ENV !== 'production') {
      try {
        return await edgeAuth();
      } catch {
        await logSessionRejection('edge_session_decode_failed');
      }
    }
    return null;
  }
}
