/**
 * Registers the co-managed organization-SLA transition handlers into the ticket-lifecycle
 * registry (@alga-psa/tickets). Native ticket code never imports this package and never calls
 * ticketSla directly: it dispatches lifecycle events, and these handlers answer them.
 *
 * Neutrality (R4): every handler first asks the capability gate, which is cached per tenant
 * (and answers false without SQL when the flag is off or FORCE_CAPABILITIES says off). A plain
 * PSA tenant therefore reaches this code and returns before touching the transaction.
 */
import { registerTicketLifecycleHandler, type TicketLifecycleEvent } from '@alga-psa/tickets/lib/ticketLifecycleHooks';
import { serves } from '@alga-psa/core/capability';
import { tenantDb } from '@alga-psa/db';
import type { Knex } from 'knex';
import { CO_MANAGED_CAPABILITY } from './permissionsCapability';
import { applyCoManagedTicketSlaTransition, recordCoManagedTicketFirstResponse, recordCoManagedTicketReopened,
  recordCoManagedTicketResolution, syncCoManagedTicketAwaitingClientSla } from './ticketSla';

async function participates(tenant: string): Promise<boolean> {
  return (await serves(CO_MANAGED_CAPABILITY, tenant)).served;
}

type Handler<K extends TicketLifecycleEvent['kind']> = (trx: Knex.Transaction, event: Extract<TicketLifecycleEvent, { kind: K }>) => Promise<void>;
const gated = <K extends TicketLifecycleEvent['kind']>(handler: Handler<K>): Handler<K> =>
  async (trx, event) => { if (await participates(event.tenant)) await handler(trx, event); };

export const onHandoff: Handler<'handoff'> = gated(async (trx, event) => {
  const relationship = await tenantDb(trx, event.tenant).table('co_management_relationships')
    .where('relationship_id', event.relationshipId).first('sponsor_tenant', 'sponsor_client_id', 'escalation_board_id');
  if (!relationship) return;
  await applyCoManagedTicketSlaTransition(trx, relationship,
    { kind: 'ticket', tenant: event.tenant, relationshipId: event.relationshipId, id: event.ticketId },
    { workId: event.workId, firstEscalatedAt: event.firstEscalatedAt }, event.operationId, event.transition, new Date(event.occurredAt));
});
export const onResolved: Handler<'resolved'> = gated((trx, event) => recordCoManagedTicketResolution(trx, event.tenant, event.ticketId));
export const onReopened: Handler<'reopened'> = gated((trx, event) => recordCoManagedTicketReopened(trx, event.tenant, event.ticketId));
export const onAwaitingClient: Handler<'awaitingClient'> = gated((trx, event) => syncCoManagedTicketAwaitingClientSla(trx, event.tenant, event.ticketId));
export const onFirstResponse: Handler<'firstResponse'> = gated((trx, event) => recordCoManagedTicketFirstResponse(trx, {
  customerTenant: event.tenant, ticketId: event.ticketId, relationshipId: event.relationshipId, commentId: event.commentId,
  actorTenant: event.actorTenant, actorUserId: event.actorUserId, actorReferenceId: event.actorReferenceId }));

let registered = false;
/** Idempotent. Co-managed-owned transitions roll back with their handoff/comment so a clock
 * fact is never silently lost; transitions riding native ticket writes are isolated so an SLA
 * fault can never fail a native write. */
export function registerCoManagedTicketSlaHandlers(): void {
  if (registered) return;
  registered = true;
  registerTicketLifecycleHandler('handoff', onHandoff, { onError: 'rollback' });
  registerTicketLifecycleHandler('firstResponse', onFirstResponse, { onError: 'rollback' });
  registerTicketLifecycleHandler('resolved', onResolved);
  registerTicketLifecycleHandler('reopened', onReopened);
  registerTicketLifecycleHandler('awaitingClient', onAwaitingClient);
}

/** Test-only. */
export function resetCoManagedTicketSlaRegistrationForTests(): void { registered = false; }

registerCoManagedTicketSlaHandlers();
