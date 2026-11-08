'use server';

import { withAuth } from '@alga-psa/auth';
import { createTenantKnex, tenantDb } from '@alga-psa/db';
import { requireCapabilityForAction } from '@alga-psa/core/capability/server';
import { isCoManagedUuid, type CoManagedSharedResource } from '@alga-psa/co-managed';
import { coManagedBrowserActor } from '../co-managed/browserActor';

/**
 * The shared-work locator for one of this co_managed workspace's own tickets, so its native screen
 * can read and write the shared conversation. It is a locator, not an authorization: the
 * conversation and comment commands still run the single access evaluator on every call.
 * `null` means this workspace has no relationship (the ticket is not shared work).
 */
export const getCoManagedLocalTicketResourceAction = withAuth(async (user, { tenant }, ticketId: string): Promise<CoManagedSharedResource | null> => {
  await requireCapabilityForAction('co-managed', tenant, 'serves');
  if (!isCoManagedUuid(ticketId)) return null;
  await coManagedBrowserActor(user, tenant);
  const { knex } = await createTenantKnex(tenant);
  // One live relationship per workspace; after departure the newest retained one keeps reads working.
  const relationship = await tenantDb(knex, tenant).table('co_management_relationships')
    .orderByRaw('ended_at IS NULL DESC').orderBy('created_at', 'desc').first('relationship_id');
  return relationship ? { tenant, relationshipId: relationship.relationship_id as string, kind: 'ticket', id: ticketId } : null;
});
