import { withAuth, type AuthContext } from '@alga-psa/auth';
import { createTenantKnex, withTransaction } from '@alga-psa/db';
import type { IUserWithRoles } from '@alga-psa/types';
import { isClientUserType } from '@alga-psa/types';
import { getAuthenticatedClientId } from '@alga-psa/client-portal/lib/clientAuth';
import { getClientServiceRequestSubmissionSuccessMessage } from '../../../lib/service-requests';

/**
 * The author's own confirmation wording for a submission this client just made. The
 * submission id is all the browser is given back after a submit, so the message is resolved
 * here instead of travelling through the redirect URL.
 *
 * Not a `'use server'` action: this is called directly while the catalog page (a server
 * component) renders, never from a client component, so it has no reason to live in
 * `actions.ts` alongside the browser-invoked actions.
 */
export const getMyServiceRequestSubmissionSuccessMessage = withAuth(async (
  currentUser: IUserWithRoles,
  { tenant }: AuthContext,
  submissionId: string,
): Promise<string | null> => {
  if (!isClientUserType(currentUser.user_type)) {
    return null;
  }

  const { knex } = await createTenantKnex();
  return withTransaction(knex, async (trx) => {
    const clientId = await getAuthenticatedClientId(trx, currentUser.user_id, tenant);
    return getClientServiceRequestSubmissionSuccessMessage(trx, tenant, clientId, submissionId);
  });
});
