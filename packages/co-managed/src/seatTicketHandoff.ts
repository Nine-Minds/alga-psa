import { createHash } from 'node:crypto';
import type { Knex } from 'knex';
import {
  advanceSeatTicketWork, liveSeatArrangement, recordTicketAssigneeChange, seatTicketWork, tenantDb,
  type SeatArrangementRow, type SeatTicketWorkRow,
} from '@alga-psa/db';
import { coManagedSeatBoardAccess, readCoManagedSeatBoardScope } from './seatArrangement';
import { announceCoManagedSeatHandoff } from './seatNotifications';

/**
 * Who is responsible for a ticket of a client in a seat arrangement, and the handoff in each
 * direction.
 *
 *   msp --hand to client IT--> client_it --hand to MSP--> msp
 *
 * Responsibility is separate from the assignee: a ticket can be with client IT and unassigned.
 * A ticket with no work row is the MSP's at revision 0, so existing and MSP-created tickets carry
 * no row. Every handoff names the revision it saw, carries a shared note and an operation id, and
 * leaves an immutable receipt that a replay of the operation returns.
 *
 * A newly recorded handoff is announced after it commits (`announceCoManagedSeatHandoff`), which
 * is how the receiving organization is notified; a replay announces nothing.
 *
 * Internal commands with no entry point of their own; a caller must authorize the actor's access
 * to the ticket before using them.
 */

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_NOTE_LENGTH = 10000;
const MAX_REVISION = 2147483647;

export type CoManagedSeatResponsibility = 'client_it' | 'msp';

export type CoManagedSeatHandoffErrorCode = 'INVALID_HANDOFF' | 'TICKET_NOT_FOUND' | 'NO_SEAT_ARRANGEMENT' |
  'OPERATION_CONFLICT' | 'HANDOFF_CHANGED' | 'ALREADY_RESPONSIBLE' | 'ACTOR_NOT_ALLOWED' | 'BOARD_OUT_OF_SCOPE' |
  'TECHNICIAN_NOT_AVAILABLE';

export class CoManagedSeatHandoffError extends Error {
  constructor(public readonly code: CoManagedSeatHandoffErrorCode) {
    super(({
      INVALID_HANDOFF: 'Provide a valid handoff with a shared IT note.',
      TICKET_NOT_FOUND: 'This ticket is no longer available.',
      NO_SEAT_ARRANGEMENT: 'This ticket\'s client has no co-managed seat arrangement.',
      OPERATION_CONFLICT: 'This handoff was started with different details.',
      HANDOFF_CHANGED: 'This ticket was handed off or reassigned. Refresh the ticket before trying again.',
      ALREADY_RESPONSIBLE: 'Responsibility for this ticket is already as requested. Refresh the ticket to see who is responsible now.',
      ACTOR_NOT_ALLOWED: 'You cannot hand this ticket off.',
      BOARD_OUT_OF_SCOPE: 'This ticket\'s board is not shared with client IT.',
      TECHNICIAN_NOT_AVAILABLE: 'The selected technician is no longer available for this client.',
    } satisfies Record<CoManagedSeatHandoffErrorCode, string>)[code]);
    this.name = 'CoManagedSeatHandoffError';
  }
}

/** A ticket's responsibility as it now stands. `revision` is what the next handoff must name. */
export interface CoManagedSeatTicketWork {
  arrangementId: string;
  responsibility: CoManagedSeatResponsibility;
  /** Zero until the ticket's first handoff or recorded reassignment. */
  revision: number;
}

export interface CoManagedSeatHandoffRequest {
  sponsorTenant: string;
  ticketId: string;
  actorUserId: string;
  /** Idempotency key: a replay of the same request returns the original receipt. */
  operationId: string;
  /** The work revision the actor saw. Zero before the ticket's first handoff. */
  expectedRevision: number;
  /** Plain text, shared with MSP staff and the client's technicians. */
  note: string;
}

export interface CoManagedSeatHandToClientItRequest extends CoManagedSeatHandoffRequest {
  /** A technician of the ticket's client to assign the ticket to. Omitted: the assignee is left as it is. */
  technicianUserId?: string | null;
}

export interface CoManagedSeatHandoffReceipt {
  operationId: string;
  ticketId: string;
  arrangementId: string;
  from: CoManagedSeatResponsibility;
  to: CoManagedSeatResponsibility;
  /** The work revision this handoff produced. */
  revision: number;
  note: string;
  actorUserId: string;
  /** Who the handoff left the ticket assigned to, if anyone. */
  assignedTo: string | null;
  occurredAt: string;
}

/**
 * What an arrangement applies to a ticket handed to the MSP. Stored in
 * `co_managed_seat_arrangements.handoff_defaults`; `{}` applies nothing.
 */
export interface CoManagedSeatHandoffDefaults {
  /** The MSP user who receives a handed-over ticket that would otherwise be unassigned. */
  assigned_to?: string;
}

/** Reads stored handoff defaults, dropping anything that is not a known, well-formed key. */
export function coManagedSeatHandoffDefaults(stored: unknown): CoManagedSeatHandoffDefaults {
  const assignedTo = (stored as { assigned_to?: unknown } | null)?.assigned_to;
  return typeof assignedTo === 'string' && uuid.test(assignedTo) ? { assigned_to: assignedTo.toLowerCase() } : {};
}

type Sponsor = ReturnType<typeof tenantDb>;

/**
 * Who is responsible for a ticket. Null when the ticket's client has no live seat arrangement:
 * such a ticket has no responsibility at all. `msp` at revision 0 when nothing has been handed
 * off yet.
 */
export async function readCoManagedSeatTicketWork(
  db: Knex | Knex.Transaction,
  input: { sponsorTenant: string; ticketId: string },
): Promise<CoManagedSeatTicketWork | null> {
  if (![input.sponsorTenant, input.ticketId].every((id) => uuid.test(id))) return null;
  const sponsor = tenantDb(db, input.sponsorTenant);
  const ticket = await sponsor.table('tickets').where('ticket_id', input.ticketId).first('client_id');
  const arrangement = ticket && await liveSeatArrangement(sponsor, ticket.client_id);
  if (!arrangement) return null;
  return seatTicketWork(arrangement, await sponsor.table('co_managed_seat_ticket_work').where('ticket_id', input.ticketId).first());
}

/**
 * Moves a ticket's work revision on, keeping who is responsible, so a handoff prepared before a
 * reassignment is refused as stale. The native assignee writers call the underlying
 * `recordTicketAssigneeChange` in `@alga-psa/db` directly; this is the same thing by its
 * co-managed name. Returns the new revision, or null (writing nothing) when the ticket's client
 * has no live seat arrangement.
 */
export function recordCoManagedSeatTicketReassignment(
  trx: Knex.Transaction,
  input: { sponsorTenant: string; ticketId: string },
): Promise<number | null> {
  return recordTicketAssigneeChange(trx, input.sponsorTenant, input.ticketId);
}

interface HandoffContext {
  sponsor: Sponsor;
  trx: Knex.Transaction;
  request: CoManagedSeatHandToClientItRequest;
  ticket: { board_id: string | null; assigned_to: string | null };
  arrangement: SeatArrangementRow;
}

/** What differs between the two handoffs: who may ask, and who the ticket is left assigned to. */
interface HandoffDirection {
  /** Throws unless this actor may hand this ticket this way. */
  admit(context: HandoffContext): Promise<void>;
  /** The ticket's assignee after the handoff. */
  assignee(context: HandoffContext): Promise<string | null>;
}

/** The live seat a user holds, if any. A user holds at most one. */
const liveSeat = (sponsor: Sponsor, userId: string): Promise<{ arrangement_id: string; state: string } | undefined> =>
  sponsor.table('co_managed_seat_assignments').where('user_id', userId).whereNot('state', 'revoked').first('arrangement_id', 'state');

const activeInternalUser = async (sponsor: Sponsor, userId: string): Promise<boolean> =>
  Boolean(await sponsor.table('users').where({ user_id: userId, user_type: 'internal', is_inactive: false }).first('user_id'));

/** An active technician of this arrangement: the seat is accepted and the user can sign in. */
const isTechnicianOf = async (sponsor: Sponsor, arrangementId: string, userId: string): Promise<boolean> => {
  const seat = await liveSeat(sponsor, userId);
  return seat?.arrangement_id === arrangementId && seat.state === 'active' && await activeInternalUser(sponsor, userId);
};

/** MSP staff: an active internal user who is not anyone's seat technician. */
const isMspStaff = async (sponsor: Sponsor, userId: string): Promise<boolean> =>
  await activeInternalUser(sponsor, userId) && !await liveSeat(sponsor, userId);

const DIRECTIONS: Record<CoManagedSeatResponsibility, HandoffDirection> = {
  // Hand to MSP: asked by a technician of the ticket's client.
  msp: {
    async admit({ sponsor, arrangement, request }) {
      if (!await isTechnicianOf(sponsor, arrangement.arrangement_id, request.actorUserId)) {
        throw new CoManagedSeatHandoffError('ACTOR_NOT_ALLOWED');
      }
    },
    async assignee({ sponsor, arrangement, ticket }) {
      // A technician assignee does not follow the ticket to the MSP; an MSP assignee stays.
      const kept = ticket.assigned_to && !await liveSeat(sponsor, ticket.assigned_to) ? ticket.assigned_to : null;
      if (kept) return kept;
      // A default that no longer names MSP staff is skipped: the technician cannot repair the
      // MSP's settings, and the ticket arrives unassigned on its board like any other.
      const fallback = coManagedSeatHandoffDefaults(arrangement.handoff_defaults).assigned_to;
      return fallback && await isMspStaff(sponsor, fallback) ? fallback : null;
    },
  },
  // Hand to client IT: asked by MSP staff, only on a board the arrangement shares.
  client_it: {
    async admit({ sponsor, trx, arrangement, ticket, request }) {
      if (!await isMspStaff(sponsor, request.actorUserId)) throw new CoManagedSeatHandoffError('ACTOR_NOT_ALLOWED');
      const scope = await readCoManagedSeatBoardScope(trx, { sponsorTenant: request.sponsorTenant, arrangementId: arrangement.arrangement_id });
      if (!ticket.board_id || coManagedSeatBoardAccess(scope, ticket.board_id) === 'none') {
        throw new CoManagedSeatHandoffError('BOARD_OUT_OF_SCOPE');
      }
      if (request.technicianUserId && !await isTechnicianOf(sponsor, arrangement.arrangement_id, request.technicianUserId)) {
        throw new CoManagedSeatHandoffError('TECHNICIAN_NOT_AVAILABLE');
      }
    },
    async assignee({ ticket, request }) {
      return request.technicianUserId ?? ticket.assigned_to;
    },
  },
};

function snapshotRequest(input: CoManagedSeatHandToClientItRequest): CoManagedSeatHandToClientItRequest {
  const technician = input?.technicianUserId ?? null;
  if (!input || ![input.sponsorTenant, input.ticketId, input.actorUserId, input.operationId].every((id) => typeof id === 'string' && uuid.test(id)) ||
      (technician !== null && (typeof technician !== 'string' || !uuid.test(technician))) ||
      !Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0 || input.expectedRevision >= MAX_REVISION ||
      typeof input.note !== 'string' || !input.note.trim() || input.note.trim().length > MAX_NOTE_LENGTH || input.note.includes('\0')) {
    throw new CoManagedSeatHandoffError('INVALID_HANDOFF');
  }
  return {
    sponsorTenant: input.sponsorTenant.toLowerCase(), ticketId: input.ticketId.toLowerCase(),
    actorUserId: input.actorUserId.toLowerCase(), operationId: input.operationId.toLowerCase(),
    expectedRevision: input.expectedRevision, note: input.note.trim(), technicianUserId: technician?.toLowerCase() ?? null,
  };
}

/**
 * Who asked, for which ticket, to do what, with which payload. Mutable state is left out, so a
 * retry after later handoffs still finds its original receipt.
 */
function fingerprint(to: CoManagedSeatResponsibility, request: CoManagedSeatHandToClientItRequest): string {
  return createHash('sha256').update(JSON.stringify([request.sponsorTenant, request.ticketId, request.actorUserId, to,
    request.operationId, request.expectedRevision, request.note, request.technicianUserId])).digest('hex');
}

interface ReceiptRow {
  operation_id: string; ticket_id: string; arrangement_id: string; revision: number; note: string;
  from_responsibility: CoManagedSeatResponsibility; to_responsibility: CoManagedSeatResponsibility;
  actor_user_id: string; assigned_to: string | null; occurred_at: Date | string; request_fingerprint: string;
}

function receipt(row: ReceiptRow): CoManagedSeatHandoffReceipt {
  return {
    operationId: row.operation_id, ticketId: row.ticket_id, arrangementId: row.arrangement_id,
    from: row.from_responsibility, to: row.to_responsibility, revision: row.revision, note: row.note,
    actorUserId: row.actor_user_id, assignedTo: row.assigned_to, occurredAt: new Date(row.occurred_at).toISOString(),
  };
}

/**
 * The one transition both handoffs are. Locks the ticket row first, so commands on one ticket
 * serialise: of two handoffs naming the same revision exactly one wins and the other is
 * `HANDOFF_CHANGED`. Refusals are not recorded, so a refused request may be retried under the
 * same operation id.
 */
async function handOff(db: Knex, to: CoManagedSeatResponsibility, input: CoManagedSeatHandToClientItRequest): Promise<CoManagedSeatHandoffReceipt> {
  const request = snapshotRequest(input);
  const outcome = await db.transaction((trx) => recordHandoff(trx, to, DIRECTIONS[to], request));
  // After commit and once per handoff: a replay returned the original receipt.
  if (outcome.recorded) await announceCoManagedSeatHandoff(request.sponsorTenant, outcome.receipt);
  return outcome.receipt;
}

/**
 * The transition itself, in the caller's transaction, so a command that composes it (ending an
 * arrangement) commits it with its own writes. Announcing is the caller's, after that commit.
 */
async function recordHandoff(
  trx: Knex.Transaction, to: CoManagedSeatResponsibility, direction: HandoffDirection, request: CoManagedSeatHandToClientItRequest,
): Promise<{ receipt: CoManagedSeatHandoffReceipt; recorded: boolean }> {
  const requestFingerprint = fingerprint(to, request);
  {
    const sponsor = tenantDb(trx, request.sponsorTenant);
    const ticket = await sponsor.table('tickets').where('ticket_id', request.ticketId).forUpdate()
      .first('client_id', 'board_id', 'assigned_to');

    // Looked up under the ticket lock when the ticket exists, so a concurrent replay waits for the first attempt.
    const prior: ReceiptRow | undefined = await sponsor.table('co_managed_seat_ticket_handoffs')
      .where('operation_id', request.operationId).first();
    if (prior) {
      if (prior.request_fingerprint !== requestFingerprint) throw new CoManagedSeatHandoffError('OPERATION_CONFLICT');
      // The original receipt, whatever has happened to the ticket since.
      return { receipt: receipt(prior), recorded: false };
    }
    if (!ticket) throw new CoManagedSeatHandoffError('TICKET_NOT_FOUND');
    const arrangement = await liveSeatArrangement(sponsor, ticket.client_id, true);
    if (!arrangement) throw new CoManagedSeatHandoffError('NO_SEAT_ARRANGEMENT');

    const previous: SeatTicketWorkRow | undefined = await sponsor.table('co_managed_seat_ticket_work')
      .where('ticket_id', request.ticketId).forUpdate().first();
    const work = seatTicketWork(arrangement, previous);
    if (work.revision !== request.expectedRevision) throw new CoManagedSeatHandoffError('HANDOFF_CHANGED');
    if (work.responsibility === to) throw new CoManagedSeatHandoffError('ALREADY_RESPONSIBLE');

    const context: HandoffContext = { sponsor, trx, request, ticket, arrangement };
    await direction.admit(context);
    const assignedTo = await direction.assignee(context);

    if (assignedTo !== ticket.assigned_to) {
      // LEVERAGE: friction seat-handoff-assignee — the assignee is set on the ticket row directly; the native assignment writer's side effects (events, workflow triggers) are not reachable from a seat command. Notifications are: the handoff is announced after commit and seatNotifications resolves who is told by the assignment and board rules.
      await sponsor.table('tickets').where('ticket_id', request.ticketId)
        .update({ assigned_to: assignedTo, updated_by: request.actorUserId, updated_at: new Date() });
    }
    const key = { tenant: request.sponsorTenant, ticket_id: request.ticketId };
    const revision = await advanceSeatTicketWork(sponsor, key, arrangement.arrangement_id, to, previous, true);
    // write-admission: exempt — append-only receipt of the handoff, written by its owning command under the ticket lock
    const [row] = await sponsor.table('co_managed_seat_ticket_handoffs').insert({ ...key, operation_id: request.operationId,
      arrangement_id: arrangement.arrangement_id, revision, from_responsibility: work.responsibility, to_responsibility: to,
      request_fingerprint: requestFingerprint, note: request.note, actor_user_id: request.actorUserId,
      assigned_to: assignedTo }).returning('*');
    return { receipt: receipt(row), recorded: true };
  }
}

/**
 * A seat technician hands a ticket to the MSP. Responsibility becomes `msp`, a technician
 * assignee is cleared, and the arrangement's handoff defaults apply to a ticket left unassigned.
 *
 * Refuses with `ACTOR_NOT_ALLOWED` unless the actor is an active technician of the ticket's
 * client, and with every reason a handoff refuses for: `INVALID_HANDOFF` (no shared note),
 * `TICKET_NOT_FOUND`, `NO_SEAT_ARRANGEMENT`, `HANDOFF_CHANGED` (stale revision),
 * `ALREADY_RESPONSIBLE` and `OPERATION_CONFLICT` (the operation id reused with other details).
 */
export function handCoManagedSeatTicketToMsp(db: Knex, input: CoManagedSeatHandoffRequest): Promise<CoManagedSeatHandoffReceipt> {
  // Naming a technician is not part of this direction; it is dropped, not refused.
  return handOff(db, 'msp', { ...input, technicianUserId: null });
}

/**
 * MSP staff hand a ticket to client IT, optionally to a named technician of the ticket's client.
 * Responsibility becomes `client_it`; without a named technician the assignee is left as it is.
 *
 * Refuses with `BOARD_OUT_OF_SCOPE` when the arrangement does not share the ticket's board, with
 * `TECHNICIAN_NOT_AVAILABLE` when the named user is not an active technician of this client, with
 * `ACTOR_NOT_ALLOWED` unless the actor is MSP staff, and with every reason a handoff refuses for.
 */
export function handCoManagedSeatTicketToClientIt(db: Knex, input: CoManagedSeatHandToClientItRequest): Promise<CoManagedSeatHandoffReceipt> {
  return handOff(db, 'client_it', input);
}

/** What an arrangement ends with: every ticket it holds goes back to the MSP, whoever asked. */
const ARRANGEMENT_END_DIRECTION: HandoffDirection = {
  // The caller (the end command) has authorized sponsor administration; there is no technician to ask.
  async admit() {},
  assignee: (context) => DIRECTIONS.msp.assignee(context),
};

export interface CoManagedSeatArrangementReturnRequest {
  sponsorTenant: string;
  arrangementId: string;
  /** The sponsor administrator ending the arrangement; recorded as the actor of each receipt. */
  actorUserId: string;
  /** Plain text shared note recorded with each handoff. */
  note: string;
}

/** The operation id of one ticket's return at arrangement end: the same on every replay. */
function arrangementReturnOperationId(arrangementId: string, ticketId: string): string {
  const hex = createHash('sha256').update(`co-managed-seat-arrangement-end:${arrangementId}:${ticketId}`).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

/**
 * Hands every ticket the arrangement's client IT is responsible for back to the MSP, as ordinary
 * recorded transitions (`client_it` to `msp`, a receipt and a revision each), in the caller's
 * transaction and while the arrangement is still live. Returns the receipts it recorded.
 *
 * Idempotent in the state it moves: a ticket already with the MSP is not selected, and a ticket's
 * operation id is derived from the arrangement and the ticket, so a replay finds the original
 * receipt instead of recording a second one. No announcement is made: the technicians are going
 * away with the arrangement, and the MSP is told by the end command's own result.
 */
export async function returnCoManagedSeatArrangementTicketsToMsp(
  trx: Knex.Transaction, input: CoManagedSeatArrangementReturnRequest,
): Promise<CoManagedSeatHandoffReceipt[]> {
  const sponsor = tenantDb(trx, input.sponsorTenant);
  const held: Array<{ ticket_id: string; revision: number }> = await sponsor.table('co_managed_seat_ticket_work')
    .where({ arrangement_id: input.arrangementId, responsibility: 'client_it' }).orderBy('ticket_id').select('ticket_id', 'revision');
  const receipts: CoManagedSeatHandoffReceipt[] = [];
  for (const work of held) {
    const request = snapshotRequest({
      sponsorTenant: input.sponsorTenant, ticketId: work.ticket_id, actorUserId: input.actorUserId,
      operationId: arrangementReturnOperationId(input.arrangementId, work.ticket_id),
      expectedRevision: Number(work.revision), note: input.note, technicianUserId: null,
    });
    const outcome = await recordHandoff(trx, 'msp', ARRANGEMENT_END_DIRECTION, request);
    if (outcome.recorded) receipts.push(outcome.receipt);
  }
  return receipts;
}
