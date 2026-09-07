'use server';

import { withAuth } from '@alga-psa/auth';
import { createTenantKnex } from '@alga-psa/db';
import { getCoManagedTicketConversation, type CoManagedSharedResource, type CoManagedConversationCursor } from '@alga-psa/co-managed';
import { coManagedBrowserActor } from '../co-managed/browserActor';

export const getCoManagedTicketConversationAction = withAuth(async (user, { tenant }, resource: CoManagedSharedResource, before?: CoManagedConversationCursor) => {
  const actor = await coManagedBrowserActor(user, tenant), { knex } = await createTenantKnex(tenant);
  return getCoManagedTicketConversation(knex, actor, resource, before);
});
