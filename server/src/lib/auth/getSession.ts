import type { Session } from 'next-auth';

import logger from '@alga-psa/shared/core/logger';
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
    return await edgeAuth();
  } catch (error) {
    logger.error('Failed to retrieve auth session via edge auth helper', error);
    return null;
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
    return await fullAuth();
  } catch (error) {
    logger.error('Failed to retrieve auth session with revocation check', error);
    return null;
  }
}
