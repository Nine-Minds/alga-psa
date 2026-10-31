'use server';

import { withAuth } from '@alga-psa/auth';
import { createTenantKnex } from '@alga-psa/db';
import { requireCapabilityForAction } from '@alga-psa/core/capability/server';
import { getCoManagedSharedWorkSummary, isCoManagedSharedWorkError, listCoManagedCustomerTickets } from '@alga-psa/co-managed';
import { coManagedBrowserActor } from '../co-managed/browserActor';
import { resolveCoManagedRelationshipTarget } from '../co-managed/relationshipTarget';

// Reading shared work serves what already exists, so each action gates on `serves`.
// The actor is derived from the verified session; the caller supplies no identity.

/** The Customer Tickets queue: every shared ticket the signed-in technician may read right now. */
export const listCoManagedCustomerTicketsAction = withAuth(async (user, { tenant }, input: { page?: number; pageSize?: number } = {}) => {
  await requireCapabilityForAction('co-managed', tenant, 'serves');
  const actor = await coManagedBrowserActor(user, tenant);
  const { knex } = await createTenantKnex(tenant);
  return listCoManagedCustomerTickets(knex, actor, { page: input?.page, pageSize: input?.pageSize });
});

/** One shared ticket. A denial in any access layer (or an unknown id) is `null`, which the page renders as not-found. */
export const getCoManagedSharedTicketAction = withAuth(async (user, { tenant }, relationshipId: string, ticketId: string) => {
  await requireCapabilityForAction('co-managed', tenant, 'serves');
  try {
    const actor = await coManagedBrowserActor(user, tenant);
    const { knex } = await createTenantKnex(tenant);
    const target = await resolveCoManagedRelationshipTarget(knex, tenant, relationshipId);
    if (target.side !== 'sponsor') return null;
    return await getCoManagedSharedWorkSummary(knex, actor, { tenant: target.customerTenant, relationshipId, kind: 'ticket', id: ticketId });
  } catch (error) {
    if (isCoManagedSharedWorkError(error)) return null;
    throw error;
  }
});
