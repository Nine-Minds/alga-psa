/**
 * MSP SLA timers pause while a ticket of a seat arrangement is with client IT, and resume when it
 * returns to the MSP.
 *
 * Two parts, registered together (see ./ticketSlaRegistration):
 *
 *  - a pause CONDITION (`@alga-psa/shared/lib/sla/slaPauseConditions`): "responsibility is client IT under
 *    the client's live arrangement". Every SLA pause re-evaluation consults it, so a status or
 *    response-state change on a ticket that is with client IT cannot resume the clock, and a
 *    handback does not resume a clock that is still paused for another reason.
 *  - a lifecycle HANDLER for `seatResponsibility`: it only re-evaluates (`syncPauseState`), which
 *    pauses or resumes to match the conditions as they now stand.
 *
 * Neutrality: both stop at the release gate (flag AND `co-managed-seat` served), before any query.
 * Past the gate the condition reads the ticket's client and its live arrangement, then the work row.
 */
import { registerAfterCommit, registerSeatResponsibilityObserver, runWithTenant } from '@alga-psa/db';
import { registerSlaPauseCondition, type SlaPauseConditionContributor } from '@alga-psa/shared/lib/sla/slaPauseConditions';
import { dispatchTicketLifecycle, registerTicketLifecycleHandler, type TicketLifecycleEvent } from '@alga-psa/tickets/lib/ticketLifecycleHooks';
import type { Knex } from 'knex';
import { coManagedSeatReleased } from './seatRelease';
import { readCoManagedSeatTicketWork } from './seatTicketHandoff';

export const CO_MANAGED_SEAT_SLA_PAUSE_CONDITION_ID = 'co-managed-seat-client-it';

export const clientItResponsibilityPauseCondition: SlaPauseConditionContributor = async (trx, tenant, ticketId) => {
  if (!await coManagedSeatReleased(tenant)) return null;
  const work = await readCoManagedSeatTicketWork(trx, { sponsorTenant: tenant, ticketId });
  return work?.responsibility === 'client_it' ? 'client_it_responsibility' : null;
};

/**
 * Re-evaluates the ticket's SLA pause state after responsibility changed. A failed write throws, so
 * with the `rollback` policy the handoff and its clock fact commit together or not at all.
 */
export async function onSeatResponsibility(trx: Knex.Transaction, event: Extract<TicketLifecycleEvent, { kind: 'seatResponsibility' }>): Promise<void> {
  if (!await coManagedSeatReleased(event.tenant)) return;
  // Loaded only past the gate: an ordinary tenant never loads the SLA package for this.
  const { syncPauseState, dispatchSlaBackendActions } = await import('@alga-psa/sla/services');
  const result = await syncPauseState(trx, event.tenant, event.ticketId, event.actorUserId);
  if (!result.success) throw new Error(`SLA pause state could not follow the responsibility change: ${result.error ?? 'unknown error'}`);
  if (result.backendActions?.length) {
    // The timer backend is told after the handoff commits, never from inside its transaction.
    registerAfterCommit(trx, () => runWithTenant(event.tenant, () => dispatchSlaBackendActions(result.backendActions)),
      `SEAT_RESPONSIBILITY_SLA ticket=${event.ticketId}`);
  }
}

export function registerCoManagedSeatSla(): void {
  registerSlaPauseCondition(CO_MANAGED_SEAT_SLA_PAUSE_CONDITION_ID, clientItResponsibilityPauseCondition);
  registerTicketLifecycleHandler('seatResponsibility', onSeatResponsibility, { onError: 'rollback' });
  // Writers below this package (a move out of the arrangement's scope) announce through the same event.
  registerSeatResponsibilityObserver(CO_MANAGED_SEAT_SLA_PAUSE_CONDITION_ID, (trx, change) =>
    dispatchTicketLifecycle(trx, { kind: 'seatResponsibility', tenant: change.tenant, ticketId: change.ticketId,
      arrangementId: change.arrangementId, from: change.from, to: change.to, operationId: null,
      occurredAt: change.occurredAt.toISOString() }));
}
