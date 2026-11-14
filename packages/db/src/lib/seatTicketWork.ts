import type { Knex } from 'knex';
import { tenantDb, type TenantDb } from './tenantDb';

/**
 * A ticket's seat work state: who is responsible for a ticket of a client in a co-managed seat
 * arrangement, and the revision the next handoff must name.
 *
 * Lives beside the tenant database layer because every writer of `tickets.assigned_to` advances
 * it, and those writers sit below the co-managed package that owns the handoff commands.
 */

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type SeatTicketResponsibility = 'client_it' | 'msp';
export interface SeatArrangementRow { arrangement_id: string; handoff_defaults: unknown }
export interface SeatTicketWorkRow { arrangement_id: string; responsibility: SeatTicketResponsibility; revision: number }

/** A ticket's responsibility as it now stands. `revision` is what the next handoff must name. */
export interface SeatTicketWork {
  arrangementId: string;
  responsibility: SeatTicketResponsibility;
  /** Zero until the ticket's first handoff or reassignment. */
  revision: number;
}

/** The client's live arrangement. `lock` holds it to commit, so it cannot end under a writer. */
export async function liveSeatArrangement(sponsor: TenantDb, clientId: string | null, lock = false): Promise<SeatArrangementRow | undefined> {
  if (!clientId) return undefined;
  const query = sponsor.table('co_managed_seat_arrangements').where({ client_id: clientId, state: 'active' });
  return (lock ? query.forShare() : query).first('arrangement_id', 'handoff_defaults');
}

/**
 * A work row written under an earlier arrangement keeps the ticket's revision, so receipts stay
 * ordered, but not its responsibility: under a new arrangement the ticket starts with the MSP.
 */
export function seatTicketWork(arrangement: SeatArrangementRow, row: SeatTicketWorkRow | undefined): SeatTicketWork {
  return {
    arrangementId: arrangement.arrangement_id,
    responsibility: row && row.arrangement_id === arrangement.arrangement_id ? row.responsibility : 'msp',
    revision: row?.revision ?? 0,
  };
}

/** Moves a ticket's work revision on. Caller holds the ticket row lock. Returns the new revision. */
export async function advanceSeatTicketWork(
  sponsor: TenantDb,
  key: { tenant: string; ticket_id: string },
  arrangementId: string,
  responsibility: SeatTicketResponsibility,
  previous: SeatTicketWorkRow | undefined,
  transition: boolean,
): Promise<number> {
  const revision = (previous?.revision ?? 0) + 1;
  const now = new Date();
  // write-admission: exempt — seat responsibility state, written by its owning command under the ticket lock
  if (!previous) await sponsor.table('co_managed_seat_ticket_work').insert({ ...key, arrangement_id: arrangementId,
    responsibility, revision, last_transition_at: now });
  // write-admission: exempt — seat responsibility state, written by its owning command under the ticket lock
  else await sponsor.table('co_managed_seat_ticket_work').where('ticket_id', key.ticket_id).update({
    arrangement_id: arrangementId, responsibility, revision, updated_at: now, ...(transition ? { last_transition_at: now } : {}) });
  return revision;
}

/**
 * What every writer that changes a ticket's assignee (`tickets.assigned_to`) calls, in the
 * transaction that changes it: moves the ticket's work revision on, keeping who is responsible,
 * so a handoff prepared before the reassignment is refused as stale.
 *
 * Takes the ticket row lock first, as the handoff commands do, so the two serialise. Returns the
 * new revision, or null (writing nothing) when the ticket's client has no live seat arrangement.
 */
export async function recordTicketAssigneeChange(
  trx: Knex.Transaction,
  tenant: string,
  ticketId: string,
): Promise<number | null> {
  if (![tenant, ticketId].every((id) => uuid.test(id))) return null;
  const sponsor = tenantDb(trx, tenant);
  const ticket = await sponsor.table('tickets').where('ticket_id', ticketId).forUpdate().first('client_id');
  const arrangement = ticket && await liveSeatArrangement(sponsor, ticket.client_id, true);
  if (!arrangement) return null;
  const previous: SeatTicketWorkRow | undefined = await sponsor.table('co_managed_seat_ticket_work')
    .where('ticket_id', ticketId).forUpdate().first();
  return advanceSeatTicketWork(sponsor, { tenant, ticket_id: ticketId }, arrangement.arrangement_id,
    seatTicketWork(arrangement, previous).responsibility, previous, false);
}

/**
 * For a writer that sets a ticket's assignee without first reading the ticket. Locks the ticket
 * row and notes its assignee; call the returned function with the assignee just written, and the
 * change is recorded only if the assignee actually changed.
 */
export async function prepareTicketAssigneeChange(
  trx: Knex.Transaction,
  tenant: string,
  ticketId: string,
): Promise<(assignedTo: string | null | undefined) => Promise<void>> {
  const ticket = await tenantDb(trx, tenant).table('tickets').where('ticket_id', ticketId).forUpdate().first('assigned_to');
  return async (assignedTo) => {
    if (ticket && (ticket.assigned_to ?? null) !== (assignedTo ?? null)) await recordTicketAssigneeChange(trx, tenant, ticketId);
  };
}
