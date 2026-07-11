import { AsyncLocalStorage } from 'node:async_hooks';
import type { IUserWithRoles } from '@alga-psa/types';

/**
 * Request-scoped identity override for API-key callers.
 *
 * `withAuth`-wrapped server actions resolve their caller via
 * `getCurrentUser()`, which reads the NextAuth session — so API routes that
 * delegate to those actions were session-only. Route handlers that
 * authenticate an Alga API key (e.g. the workflow authoring surface used by
 * the MCP connector) run the action inside `runWithApiKeyUser` with the
 * key's resolved user, and `getCurrentUser()` returns that identity instead
 * of consulting the session.
 */
const apiKeyUserStorage = new AsyncLocalStorage<IUserWithRoles>();

export function runWithApiKeyUser<T>(user: IUserWithRoles, fn: () => Promise<T>): Promise<T> {
  return apiKeyUserStorage.run(user, fn);
}

export function getApiKeyUserOverride(): IUserWithRoles | undefined {
  return apiKeyUserStorage.getStore();
}
