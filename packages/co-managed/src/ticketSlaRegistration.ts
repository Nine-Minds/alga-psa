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
import logger from '@alga-psa/core/logger';
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
  const result = await applyCoManagedTicketSlaTransition(trx, relationship,
    { kind: 'ticket', tenant: event.tenant, relationshipId: event.relationshipId, id: event.ticketId },
    { workId: event.workId, firstEscalatedAt: event.firstEscalatedAt }, event.operationId, event.transition, new Date(event.occurredAt));
  // Missing MSP setup never blocks a handoff: the ticket is simply untimed, and the shared-ticket card says so.
  if (result.outcome === 'skipped') logger.info('[co-managed] organization SLA not started for handoff', {
    tenant: event.tenant, ticketId: event.ticketId, transition: event.transition, reason: result.reason });
});
export const onResolved: Handler<'resolved'> = gated((trx, event) => recordCoManagedTicketResolution(trx, event.tenant, event.ticketId));
export const onReopened: Handler<'reopened'> = gated((trx, event) => recordCoManagedTicketReopened(trx, event.tenant, event.ticketId));
export const onAwaitingClient: Handler<'awaitingClient'> = gated((trx, event) => syncCoManagedTicketAwaitingClientSla(trx, event.tenant, event.ticketId));
export const onFirstResponse: Handler<'firstResponse'> = gated((trx, event) => recordCoManagedTicketFirstResponse(trx, {
  customerTenant: event.tenant, ticketId: event.ticketId, relationshipId: event.relationshipId, commentId: event.commentId,
  actorTenant: event.actorTenant, actorUserId: event.actorUserId, actorReferenceId: event.actorReferenceId }));

let registered = false;
/** Idempotent. Missing SLA setup is a typed `skipped` result, never an error, so it cannot reach
 * the rollback policy. What can still throw is a genuine fault: a broken invariant (ticket or status
 * row missing mid-transition) or a store/database failure. Those use `rollback` on the co-managed-owned
 * handoff and first response, deliberately: the handoff and its clock fact are one fact, and committing
 * a handoff whose clock write failed would leave a timed obligation silently missing with no
 * reconciliation path. Transitions riding native ticket writes are isolated so an SLA fault can never
 * fail a native write. */
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
