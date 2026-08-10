import type { Session } from 'next-auth';

import logger from '@alga-psa/core/logger';
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
    || (userType !== 'internal' && userType !== 'client')
    || typeof sessionId !== 'string'
    || sessionId.length === 0
  ) {
    logger.warn('[auth] Rejecting session without complete tracked identity claims');
    return null;
  }

  try {
    if (await UserSession.isRevokedOrIdentityMismatch(tenant, sessionId, {
      userId,
      userType,
    })) {
      return null;
    }
  } catch (error) {
    logger.error('[auth] Session revocation check failed closed', error);
    return null;
  }

  return session;
}

async function decodeSession(): Promise<Session | null> {
  try {
    const edgeSession = await edgeAuth();
    if (edgeSession) {
      return edgeSession;
    }

    // Edge auth can legitimately return null (or fail) in dev / after hot reloads.
    // Fall back to the full Node.js helper which is more tolerant.
    return await fullAuth();
  } catch (error) {
    logger.error('Failed to retrieve auth session via edge auth helper; falling back to full auth', error);
    try {
      return await fullAuth();
    } catch (fallbackError) {
      logger.error('Failed to retrieve auth session via full auth helper', fallbackError);
      return null;
    }
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
      } catch (edgeError) {
        logger.error('Dev fallback: failed to retrieve auth session via edge auth helper', edgeError);
      }
    }

    return null;
  } catch (error) {
    logger.error('Failed to retrieve auth session with revocation check', error);
    if (process.env.NODE_ENV !== 'production') {
      try {
        return await edgeAuth();
      } catch (edgeError) {
        logger.error('Dev fallback: failed to retrieve auth session via edge auth helper', edgeError);
      }
    }
    return null;
  }
}
