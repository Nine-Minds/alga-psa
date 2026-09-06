'use server';

import { withAuth, getSession, getApiKeyUserOverride } from '@alga-psa/auth';
import { createTenantKnex } from '@alga-psa/db';
import { getCoManagedSharedWorkSummary, CoManagedSharedWorkError, type CoManagedSharedResource } from '@alga-psa/co-managed';

export const getSharedWorkSummaryAction = withAuth(async (user, { tenant }, resource: CoManagedSharedResource) => {
  // A browser session cannot lend its authority to an API-key/automation
  // override. Those adapters must carry and enforce their own credentials.
  if (getApiKeyUserOverride() || user.user_type !== 'internal') throw new CoManagedSharedWorkError();
  const session = await getSession();
  if (!session?.session_id || session.user?.tenant !== tenant || session.user?.id !== user.user_id || session.user?.user_type !== 'internal') {
    throw new CoManagedSharedWorkError();
  }
  const { knex } = await createTenantKnex(tenant);
  return getCoManagedSharedWorkSummary(knex, { kind: 'session', tenant, userId: user.user_id, sessionId: session.session_id }, resource);
});
