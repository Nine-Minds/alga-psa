'use server';

import { withAuth, getSession, getApiKeyUserOverride } from '@alga-psa/auth';
import { createTenantKnex } from '@alga-psa/db';
import { getCoManagedSharedWorkSummary, escalateCoManagedTicket, handBackCoManagedTicket, revokeCoManagedTicketGrant, CoManagedSharedWorkError, type CoManagedSharedResource, type CoManagedTicketHandoffRequest } from '@alga-psa/co-managed';

async function browserActor(user: { user_id: string; user_type?: string }, tenant: string) {
  // A browser session cannot lend its authority to an API-key/automation
  // override. Those adapters must carry and enforce their own credentials.
  if (getApiKeyUserOverride() || user.user_type !== 'internal') throw new CoManagedSharedWorkError();
  const session = await getSession();
  if (!session?.session_id || session.user?.tenant !== tenant || session.user?.id !== user.user_id || session.user?.user_type !== 'internal') {
    throw new CoManagedSharedWorkError();
  }
  return { kind: 'session' as const, tenant, userId: user.user_id, sessionId: session.session_id };
}

export const getSharedWorkSummaryAction = withAuth(async (user, { tenant }, resource: CoManagedSharedResource) => {
  const actor = await browserActor(user, tenant);
  const { knex } = await createTenantKnex(tenant);
  return getCoManagedSharedWorkSummary(knex, actor, resource);
});

export const escalateSharedTicketAction = withAuth(async (user, { tenant }, resource: CoManagedSharedResource, request: CoManagedTicketHandoffRequest) => {
  const actor = await browserActor(user, tenant);
  const { knex } = await createTenantKnex(tenant);
  return escalateCoManagedTicket(knex, actor, resource, request);
});

export const handBackSharedTicketAction = withAuth(async (user, { tenant }, resource: CoManagedSharedResource, request: CoManagedTicketHandoffRequest) => {
  const actor = await browserActor(user, tenant);
  const { knex } = await createTenantKnex(tenant);
  return handBackCoManagedTicket(knex, actor, resource, request);
});


export const revokeSharedTicketGrantAction = withAuth(async (user, { tenant }, resource: CoManagedSharedResource, request: CoManagedTicketHandoffRequest) => {
  const actor = await browserActor(user, tenant);
  const { knex } = await createTenantKnex(tenant);
  return revokeCoManagedTicketGrant(knex, actor, resource, request);
});
