import type { Knex } from 'knex';
import { isCapabilityServed } from '@alga-psa/core/capability';
import { prepareTicketResourceReassignment } from './reassignTicketResources';
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

/** The two columns that decide which seat arrangement, if any, shares a ticket. */
export interface SeatTicketPlacement { client_id?: string | null; board_id?: string | null }

/**
 * What every writer that changes a ticket's client or board (`tickets.client_id`,
 * `tickets.board_id`) calls, in the transaction that changed it, with the ticket as it was and
 * as it now is.
 *
 * A ticket is shared with client IT only by the live arrangement of its client, and only on a
 * board in that arrangement's scope. When a move takes the ticket out of that, nobody chose to
 * hand it back, so this does: a seat technician who may no longer work the ticket is cleared as
 * its assignee and dropped as an additional agent, and responsibility returns to the MSP. The
 * technician's access is derived from the ticket's client and board, so it ends with the move;
 * comments, shared notes included, are not touched.
 *
 * State-based and idempotent: it settles the ticket as it stands, whatever the writer changed.
 * A tenant the `co-managed-seat` capability does not serve pays nothing, and only a move asks. Returns whether
 * the assignee was cleared, so the writer can report the ticket it now returns truthfully.
 */
export async function releaseSeatTicketOnMove(
  trx: Knex.Transaction,
  tenant: string,
  ticketId: string,
  before: SeatTicketPlacement,
  after: SeatTicketPlacement,
): Promise<{ assigneeCleared: boolean }> {
  const settled = { assigneeCleared: false };
  if ((before.client_id ?? null) === (after.client_id ?? null) && (before.board_id ?? null) === (after.board_id ?? null)) return settled;
  if (![tenant, ticketId].every((id) => uuid.test(id))) return settled;
  const sponsor = tenantDb(trx, tenant);
  // Served: a tenant outside the `co-managed-seat` capability has no technician and no work row,
  // and pays no statement here (the verdict is cached per tenant).
  if (!await isCapabilityServed('co-managed-seat', tenant)) return settled;

  const ticket = await sponsor.table('tickets').where('ticket_id', ticketId).forUpdate().first('client_id', 'board_id', 'assigned_to');
  if (!ticket) return settled;
  const arrangement = await liveSeatArrangement(sponsor, ticket.client_id, true);
  const shared = arrangement && ticket.board_id && await sponsor.table('co_managed_seat_board_scopes')
    .where({ arrangement_id: arrangement.arrangement_id, board_id: ticket.board_id }).first('board_id');
  /** The arrangement whose technicians may work the ticket where it now is. */
  const home: string | null = shared ? arrangement.arrangement_id : null;

  const agents: Array<{ additional_user_id: string | null }> = await sponsor.table('ticket_resources')
    .where('ticket_id', ticketId).select('additional_user_id');
  const people = [ticket.assigned_to, ...agents.map((agent) => agent.additional_user_id)].filter((id): id is string => Boolean(id));
  const seats: Array<{ user_id: string; arrangement_id: string }> = people.length
    ? await sponsor.table('co_managed_seat_assignments').whereIn('user_id', people).whereNot('state', 'revoked').select('user_id', 'arrangement_id')
    : [];
  const strangers = seats.filter((seat) => seat.arrangement_id !== home).map((seat) => seat.user_id);

  if (strangers.length) {
    await sponsor.table('ticket_resources').where('ticket_id', ticketId).whereIn('additional_user_id', strangers).del();
  }
  if (ticket.assigned_to && strangers.includes(ticket.assigned_to)) {
    // Additional agents are keyed to the primary assignee, so they go with it, as on any unassignment.
    const finalizeResources = await prepareTicketResourceReassignment(trx, tenant, ticketId, ticket.assigned_to, null);
    // LEVERAGE: friction seat-handoff-assignee — the assignee is set on the ticket row directly; the native assignment writer's side effects (events, notifications) are not reachable from here
    await sponsor.table('tickets').where('ticket_id', ticketId).update({ assigned_to: null, updated_at: new Date() });
    await finalizeResources();
    settled.assigneeCleared = true;
  }

  const previous: SeatTicketWorkRow | undefined = await sponsor.table('co_managed_seat_ticket_work')
    .where('ticket_id', ticketId).forUpdate().first();
  const key = { tenant, ticket_id: ticketId };
  if (previous?.responsibility === 'client_it' && previous.arrangement_id !== home) {
    // Written, not left to be read as stale: a ticket that later comes back must not revive client IT's turn.
    await advanceSeatTicketWork(sponsor, key, previous.arrangement_id, 'msp', previous, true);
  } else if (settled.assigneeCleared && arrangement) {
    // An assignee change like any other: a handoff prepared before it is stale.
    await advanceSeatTicketWork(sponsor, key, arrangement.arrangement_id, seatTicketWork(arrangement, previous).responsibility, previous, false);
  }
  return settled;
}
