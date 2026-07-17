import type { NextRequest } from 'next/server';
import type { IUserWithRoles } from '@alga-psa/types';
import { runWithApiKeyUser } from '@alga-psa/auth';
import { authenticateApiKeyRequest } from './apiAuthMiddleware';

/**
 * Bridge API-key auth into `withAuth`-wrapped server actions.
 *
 * Some v1 routes delegate straight to server actions whose `withAuth` wrapper
 * resolves the caller via `getCurrentUser()` (the NextAuth session) — making
 * them session-only, so an `x-api-key` request 500s with no user. This runs the
 * action with the key's resolved user as the effective identity when an API key
 * is present; browser/session callers pass straight through unchanged.
 */
export async function runWithApiKeyOrSession<T>(req: NextRequest | Request, fn: () => Promise<T>): Promise<T> {
  const apiKey = req.headers.get('x-api-key');
  if (!apiKey) return fn();
  const apiRequest = await authenticateApiKeyRequest(req as NextRequest);
  const user = apiRequest.context!.user as unknown as IUserWithRoles;
  return runWithApiKeyUser(user, fn);
}
