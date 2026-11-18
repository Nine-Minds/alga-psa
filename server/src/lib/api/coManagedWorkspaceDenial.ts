import { getAdminConnection } from '@alga-psa/db';
import { coManagedAcceptancePendingError, isCoManagedAwaitingAcceptanceLazily } from '@alga-psa/licensing/lifecycle';
import { handleApiError } from './middleware/apiMiddleware';

/** Session-authenticated byte routes also need the consent check used by
 * withAuth and API-key authentication. Cache hits never acquire a connection. */
export async function coManagedWorkspaceDenial(tenant: string) {
  if (await isCoManagedAwaitingAcceptanceLazily(() => getAdminConnection(), tenant)) {
    return handleApiError(coManagedAcceptancePendingError());
  }
  return null;
}
