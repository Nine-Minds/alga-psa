'use server';

import { withAuth } from '@alga-psa/auth';
import { requireCapabilityForAction, CapabilityUnavailableError } from '@alga-psa/core/capability/server';
import { coManagedBrowserActor as browserActor } from '../co-managed/browserActor';
import { createTenantKnex, tenantDb, withTransaction } from '@alga-psa/db';
import { getCoManagedSharedTicketDetails, getCoManagedTicketEditor, searchCoManagedTicketEditOptions } from '@alga-psa/co-managed';
import { isCoManagedLifecycleError } from '@alga-psa/licensing/lifecycle';
import { buildSharedTicketData } from '../co-managed/sharedTicketData';
import type { SharedTicketDetailsResult, SharedTicketOptionPage } from '../co-managed/sharedTicketDataTypes';
import { getCoManagedSharedWorkSummary, getCoManagedTicketScreen, getCoManagedTicketHandoffHistory, getCoManagedExplicitTicketGrants, escalateCoManagedTicket, handBackCoManagedTicket, revokeCoManagedTicketGrant, CoManagedSharedWorkError, type CoManagedSharedResource, type CoManagedTicketHandoffRequest } from '@alga-psa/co-managed';


export const getSharedWorkSummaryAction = withAuth(async (user, { tenant }, resource: CoManagedSharedResource) => {
  await requireCapabilityForAction('co-managed', tenant, 'serves');
  const actor = await browserActor(user, tenant);
  const { knex } = await createTenantKnex(tenant);
  return getCoManagedSharedWorkSummary(knex, actor, resource);
});

/**
 * A handoff command's gate is side-aware, like L2's `withCoManagedHeld`: the customer side (session tenant ===
 * resource.tenant) is never entitled and only ever `serves`; the sponsor side must still be `admits`-ted.
 * The side comes from the resource and the session tenant alone, so a forced-off or flag-off tenant is refused
 * here, before any co-managed table is read.
 */
async function requireHandoffCapability(tenant: string, resource: CoManagedSharedResource, customerSideOnly: boolean): Promise<void> {
  // LEVERAGE: pattern capability-either-mode — second two-sided action; the adapter should land next to requireCapabilityForAction (see withCoManagedHeld in coManagedPolicyActions.ts).
  const customerSide = typeof resource?.tenant === 'string' && resource.tenant === tenant;
  // Escalation is the customer's act; a sponsor-side caller has no such command to start.
  if (customerSideOnly && !customerSide) throw new CapabilityUnavailableError();
  await requireCapabilityForAction('co-managed', tenant, customerSide ? 'serves' : 'admits');
}

export const escalateSharedTicketAction = withAuth(async (user, { tenant }, resource: CoManagedSharedResource, request: CoManagedTicketHandoffRequest) => {
  await requireHandoffCapability(tenant, resource, true);
  const actor = await browserActor(user, tenant);
  const { knex } = await createTenantKnex(tenant);
  // LEVERAGE: friction shared-ticket-sla — the SLA setup-required result returns with L6b.
  return escalateCoManagedTicket(knex, actor, resource, request);
});

export const handBackSharedTicketAction = withAuth(async (user, { tenant }, resource: CoManagedSharedResource, request: CoManagedTicketHandoffRequest) => {
  await requireHandoffCapability(tenant, resource, false);
  const actor = await browserActor(user, tenant);
  const { knex } = await createTenantKnex(tenant);
  return handBackCoManagedTicket(knex, actor, resource, request);
});


export const revokeSharedTicketGrantAction = withAuth(async (user, { tenant }, resource: CoManagedSharedResource, request: CoManagedTicketHandoffRequest) => {
  await requireCapabilityForAction('co-managed', tenant, 'serves');
  const actor = await browserActor(user, tenant);
  const { knex } = await createTenantKnex(tenant);
  return revokeCoManagedTicketGrant(knex, actor, resource, request);
});


export type CoManagedTicketScreenTarget = { kind: 'local'; ticketId: string } | { kind: 'shared'; resource: CoManagedSharedResource };

async function loadTicketScreen(tenant: string, user: Parameters<typeof browserActor>[0], target: CoManagedTicketScreenTarget) {
  const actor = await browserActor(user, tenant);
  const { knex } = await createTenantKnex(tenant);
  return withTransaction(knex, async trx => {
    if (target?.kind === 'shared') return getCoManagedTicketScreen(trx, actor, target.resource);
    if (target?.kind !== 'local' || typeof target.ticketId !== 'string' || !/^[0-9a-f-]{36}$/i.test(target.ticketId)) throw new CoManagedSharedWorkError();
    const relationship = await tenantDb(trx, tenant).table('co_management_relationships').where({ state: 'active' }).whereNull('ended_at').first('relationship_id');
    if (!relationship) throw new CoManagedSharedWorkError();
    return getCoManagedTicketScreen(trx, actor, { tenant, relationshipId: relationship.relationship_id, kind: 'ticket', id: target.ticketId });
  });
}

export const getCoManagedTicketScreenAction = withAuth(async (user, { tenant }, target: CoManagedTicketScreenTarget) => {
  await requireCapabilityForAction('co-managed', tenant, 'serves');
  return loadTicketScreen(tenant, user, target);
});

/** Everything the native ticket screen needs for a shared ticket, from admitted and
 * redacted co-managed reads only. Sponsor sessions: each read below re-runs its own
 * admission, so a revoked grant or missing staff assignment fails the whole load. */
export const getSharedTicketDetailsAction = withAuth(async (user, { tenant }, resource: CoManagedSharedResource): Promise<SharedTicketDetailsResult> => {
  await requireCapabilityForAction('co-managed', tenant, 'serves');
  if (resource?.kind !== 'ticket') throw new CoManagedSharedWorkError();
  const screen = await loadTicketScreen(tenant, user, { kind: 'shared', resource });
  const actor = await browserActor(user, tenant);
  const { knex } = await createTenantKnex(tenant);
  const details = await getCoManagedSharedTicketDetails(knex, actor, resource);
  const editor = await getCoManagedTicketEditor(knex, actor, resource);
  const firstPage = async (field: 'status_id' | 'priority_id'): Promise<SharedTicketOptionPage> => {
    if (!editor.editableFields.includes(field)) return { options: [], nextAfterId: null };
    try { return await searchCoManagedTicketEditOptions(knex, actor, resource, { field }); }
    catch (error) {
      // The editor is the authority for what is editable; a lifecycle lapse between the
      // two reads degrades the picker to the current value rather than failing the screen.
      if (isCoManagedLifecycleError(error)) return { options: [], nextAfterId: null };
      throw error;
    }
  };
  return buildSharedTicketData({ resource, screen, details, editor,
    statusOptions: await firstPage('status_id'), priorityOptions: await firstPage('priority_id') });
});

export const getSharedTicketHandoffHistoryAction = withAuth(async (user, { tenant }, resource: CoManagedSharedResource, beforeRevision?: number) => {
  await requireCapabilityForAction('co-managed', tenant, 'serves');
  const actor = await browserActor(user, tenant);
  const { knex } = await createTenantKnex(tenant);
  return getCoManagedTicketHandoffHistory(knex, actor, resource, beforeRevision);
});

export const getExplicitTicketGrantsAction = withAuth(async (user, { tenant }, afterTicketId?: string) => {
  await requireCapabilityForAction('co-managed', tenant, 'serves');
  const actor = await browserActor(user, tenant);
  const { knex } = await createTenantKnex(tenant);
  return getCoManagedExplicitTicketGrants(knex, actor, afterTicketId);
});
