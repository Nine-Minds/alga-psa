import type { Session } from 'next-auth';

import logger from '@alga-psa/shared/core/logger';
import { auth as edgeAuth } from 'server/src/app/api/auth/[...nextauth]/edge-auth';

/**
 * Returns the current session using the edge-safe Auth.js instance.
 * This avoids the `/api/auth/session` round-trip that the Node helper performs,
 * keeping middleware and server actions from triggering auth redirects.
 */
export async function getSession(): Promise<Session | null> {
  try {
    return await edgeAuth();
  } catch (error) {
    logger.error('Failed to retrieve auth session via edge auth helper', error);
    return null;
  }
}
