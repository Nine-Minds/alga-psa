'use server';

import { withAuth } from '@alga-psa/auth';
import { requireCapabilityForAction, CapabilityUnavailableError } from '@alga-psa/core/capability/server';
import { coManagedBrowserActor as browserActor } from '../co-managed/browserActor';
import { createTenantKnex, tenantDb, withTransaction } from '@alga-psa/db';
import { getCoManagedSharedTicketDetails, getCoManagedTicketEditor, searchCoManagedTicketEditOptions } from '@alga-psa/co-managed';
import { isCoManagedLifecycleError } from '@alga-psa/licensing/lifecycle';
import { buildSharedTicketData } from '../co-managed/sharedTicketData';
import type { SharedTicketDetailsResult, SharedTicketOptionPage } from '../co-managed/sharedTicketDataTypes';
import { getCoManagedSharedWorkSummary, getCoManagedTicketScreen, getCoManagedTicketHandoffHistory, getCoManagedExplicitTicketGrants, escalateCoManagedTicket, handBackCoManagedTicket, revokeCoManagedTicketGrant, CoManagedSharedWorkError, CoManagedTicketHandoffError, isCoManagedSharedWorkError, type CoManagedSharedResource, type CoManagedTicketHandoffRequest, type CoManagedTicketHandoffReceipt, type CoManagedTicketHandoffErrorCode } from '@alga-psa/co-managed';


export const getSharedWorkSummaryAction = withAuth(async (user, { tenant }, resource: CoManagedSharedResource) => {
  await requireCapabilityForAction('co-managed', tenant, 'serves');
  const actor = await browserActor(user, tenant);
  const { knex } = await createTenantKnex(tenant);
  return getCoManagedSharedWorkSummary(knex, actor, resource);
});

/**
 * Handoff commands are two-sided, so their gate is side-aware (like L2's `withCoManagedHeld`): the customer side
 * (session tenant === resource.tenant) is never entitled and only ever `serves`; the sponsor side must still be
 * `admits`-ted. The side comes from the resource and the session tenant alone, so a forced-off or flag-off tenant
 * is refused before any co-managed table is read. The adapter is called inline: its tenant must be the session's.
 */
const isCustomerSide = (tenant: string, resource: CoManagedSharedResource) =>
  typeof resource?.tenant === 'string' && resource.tenant === tenant;

/**
 * Production builds redact thrown server-action errors, so a handoff refusal is returned, never thrown: the
 * screen must be able to say why (stale revision, already responsible, capability closed, not shared, read-only).
 * Anything else is rethrown; every command carries an operationId, so retrying the same request is always safe.
 */
export type SharedTicketHandoffRefusalCode =
  CoManagedTicketHandoffErrorCode | 'CAPABILITY_UNAVAILABLE' | 'NOT_AVAILABLE' | 'READ_ONLY';
export type SharedTicketHandoffResult =
  { ok: true; receipt: CoManagedTicketHandoffReceipt } | { ok: false; code: SharedTicketHandoffRefusalCode };

// LEVERAGE: pattern co-managed-action-refusal — 5th error→{ok:false,code} mapper (edit, assignment, delegated, policy, handoff); refusal-coded errors want one action wrapper.
function handoffRefusal(error: unknown): SharedTicketHandoffResult {
  if (error instanceof CapabilityUnavailableError) return { ok: false, code: 'CAPABILITY_UNAVAILABLE' };
  if (error instanceof CoManagedTicketHandoffError) return { ok: false, code: error.code };
  if (isCoManagedSharedWorkError(error)) return { ok: false, code: 'NOT_AVAILABLE' };
  if (isCoManagedLifecycleError(error)) return { ok: false, code: 'READ_ONLY' };
  throw error;
}

export const escalateSharedTicketAction = withAuth(async (user, { tenant }, resource: CoManagedSharedResource, request: CoManagedTicketHandoffRequest): Promise<SharedTicketHandoffResult> => {
  try {
    // Escalation is the customer's act; a sponsor-side caller has no such command to start.
    if (!isCustomerSide(tenant, resource)) throw new CapabilityUnavailableError();
    await requireCapabilityForAction('co-managed', tenant, 'serves');
    const actor = await browserActor(user, tenant);
    const { knex } = await createTenantKnex(tenant);
    // LEVERAGE: friction shared-ticket-sla — the SLA setup-required result returns with L6b.
    return { ok: true, receipt: await escalateCoManagedTicket(knex, actor, resource, request) };
  } catch (error) { return handoffRefusal(error); }
});

export const handBackSharedTicketAction = withAuth(async (user, { tenant }, resource: CoManagedSharedResource, request: CoManagedTicketHandoffRequest): Promise<SharedTicketHandoffResult> => {
  try {
    // LEVERAGE: pattern capability-either-mode — second two-sided action; the adapter should land next to requireCapabilityForAction (see withCoManagedHeld in coManagedPolicyActions.ts).
    // Customer side = take-back (`serves`); sponsor side = hand-back (`admits`).
    await requireCapabilityForAction('co-managed', tenant, isCustomerSide(tenant, resource) ? 'serves' : 'admits');
    const actor = await browserActor(user, tenant);
    const { knex } = await createTenantKnex(tenant);
    return { ok: true, receipt: await handBackCoManagedTicket(knex, actor, resource, request) };
  } catch (error) { return handoffRefusal(error); }
});


export const revokeSharedTicketGrantAction = withAuth(async (user, { tenant }, resource: CoManagedSharedResource, request: CoManagedTicketHandoffRequest): Promise<SharedTicketHandoffResult> => {
  try {
    await requireCapabilityForAction('co-managed', tenant, 'serves');
    const actor = await browserActor(user, tenant);
    const { knex } = await createTenantKnex(tenant);
    return { ok: true, receipt: await revokeCoManagedTicketGrant(knex, actor, resource, request) };
  } catch (error) { return handoffRefusal(error); }
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
