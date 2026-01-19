import type { Session } from 'next-auth';

import logger from '@alga-psa/core/logger';
import { auth as edgeAuth } from 'server/src/app/api/auth/[...nextauth]/edge-auth';
import { auth as fullAuth } from 'server/src/app/api/auth/[...nextauth]/auth';

/**
 * Returns the current session using the edge-safe Auth.js instance.
 * This is optimized for performance and avoids database calls.
 *
 * For session revocation checks, use getSessionWithRevocationCheck() instead.
 */
export async function getSession(): Promise<Session | null> {
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
 * Returns the current session using the full Node.js Auth.js instance.
 * This includes JWT callbacks with session revocation checks.
 *
 * Use this in layouts and critical auth paths where revocation must be checked.
 * For better performance in non-critical paths, use getSession() instead.
 */
export async function getSessionWithRevocationCheck(): Promise<Session | null> {
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
