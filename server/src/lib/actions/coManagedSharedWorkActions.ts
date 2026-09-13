'use server';

import { withAuth } from '@alga-psa/auth';
import { coManagedBrowserActor as browserActor } from '../co-managed/browserActor';
import { createTenantKnex, tenantDb, withTransaction } from '@alga-psa/db';
import { CoManagedSlaSetupError } from '@alga-psa/co-managed';
import { getCoManagedSharedWorkSummary, getCoManagedTicketScreen, getCoManagedTicketHandoffHistory, getCoManagedExplicitTicketGrants, escalateCoManagedTicket, handBackCoManagedTicket, revokeCoManagedTicketGrant, CoManagedSharedWorkError, type CoManagedSharedResource, type CoManagedTicketHandoffRequest } from '@alga-psa/co-managed';


export const getSharedWorkSummaryAction = withAuth(async (user, { tenant }, resource: CoManagedSharedResource) => {
  const actor = await browserActor(user, tenant);
  const { knex } = await createTenantKnex(tenant);
  return getCoManagedSharedWorkSummary(knex, actor, resource);
});

export const escalateSharedTicketAction = withAuth(async (user, { tenant }, resource: CoManagedSharedResource, request: CoManagedTicketHandoffRequest) => {
  const actor = await browserActor(user, tenant);
  const { knex } = await createTenantKnex(tenant);
  try { return await escalateCoManagedTicket(knex, actor, resource, request); }
  catch (error) {
    if (error instanceof CoManagedSlaSetupError) return { setupRequired: true as const };
    throw error;
  }
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


export type CoManagedTicketScreenTarget = { kind: 'local'; ticketId: string } | { kind: 'shared'; resource: CoManagedSharedResource };

export const getCoManagedTicketScreenAction = withAuth(async (user, { tenant }, target: CoManagedTicketScreenTarget) => {
  const actor = await browserActor(user, tenant);
  const { knex } = await createTenantKnex(tenant);
  return withTransaction(knex, async trx => {
    if (target?.kind === 'shared') return getCoManagedTicketScreen(trx, actor, target.resource);
    if (target?.kind !== 'local' || typeof target.ticketId !== 'string' || !/^[0-9a-f-]{36}$/i.test(target.ticketId)) throw new CoManagedSharedWorkError();
    const relationship = await tenantDb(trx, tenant).table('co_management_relationships').where({ state: 'active' }).whereNull('ended_at').first('relationship_id');
    if (!relationship) throw new CoManagedSharedWorkError();
    return getCoManagedTicketScreen(trx, actor, { tenant, relationshipId: relationship.relationship_id, kind: 'ticket', id: target.ticketId });
  });
});

export const getSharedTicketHandoffHistoryAction = withAuth(async (user, { tenant }, resource: CoManagedSharedResource, beforeRevision?: number) => {
  const actor = await browserActor(user, tenant);
  const { knex } = await createTenantKnex(tenant);
  return getCoManagedTicketHandoffHistory(knex, actor, resource, beforeRevision);
});

export const getExplicitTicketGrantsAction = withAuth(async (user, { tenant }, afterTicketId?: string) => {
  const actor = await browserActor(user, tenant);
  const { knex } = await createTenantKnex(tenant);
  return getCoManagedExplicitTicketGrants(knex, actor, afterTicketId);
});
