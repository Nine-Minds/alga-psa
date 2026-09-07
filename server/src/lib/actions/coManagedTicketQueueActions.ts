'use server';

import { withAuth } from '@alga-psa/auth';
import { createTenantKnex } from '@alga-psa/db';
import { getCoManagedTicketQueue, type CoManagedTicketQueueRequest } from '@alga-psa/co-managed';
import { coManagedBrowserActor } from '../co-managed/browserActor';

export const getCoManagedTicketQueueAction = withAuth(async (user, { tenant }, request: CoManagedTicketQueueRequest) => {
  const actor = await coManagedBrowserActor(user, tenant);
  const { knex } = await createTenantKnex(tenant);
  return getCoManagedTicketQueue(knex, actor, request);
});
