import { randomUUID } from 'node:crypto';
import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import {
  CoManagedReservationError, reserveAndActivateCoManagedSeatAllocation, type CoManagedAllocationKind,
} from '@alga-psa/licensing';
import { admitCoManagedSeatRole } from './seatRole';

/**
 * Seat arrangements: one of the sponsor's own clients, bound to the seat allocation that pays for
 * it and to the boards its technicians may work.
 *
 * Internal commands with no entry point of their own; a caller must authorize sponsor
 * administration and access to the client before using them.
 */

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type ReservationCode = CoManagedReservationError['code'];
type ArrangementCode = ReservationCode | 'CLIENT_INACTIVE' | 'ARRANGEMENT_NOT_FOUND' | 'ARRANGEMENT_ENDED' |
  'INVALID_BOARD_SCOPE' | 'BOARD_NOT_FOUND';

export class CoManagedSeatArrangementError extends Error {
  /**
   * @param existingKind Set with `CLIENT_HAS_ARRANGEMENT`: whether the client's live arrangement
   * is a `workspace` relationship or a `seat` arrangement.
   */
  constructor(public readonly code: ArrangementCode, public readonly existingKind?: CoManagedAllocationKind) {
    super(code === 'CLIENT_HAS_ARRANGEMENT' && existingKind === 'workspace'
      ? 'This client already has a co-managed workspace.'
      : ({
        INVALID_RESERVATION: 'Provide a client and a whole number of seats.',
        SPONSOR_NOT_ELIGIBLE: 'This workspace cannot sponsor co-managed seats.',
        CAPACITY_UNAVAILABLE: 'The co-managed pool does not have enough available seats.',
        CLIENT_NOT_FOUND: 'This client is no longer available.',
        OPERATION_CONFLICT: 'This seat arrangement was started with different details.',
        ENTITLEMENT_LAPSED: 'Restore the co-managed pool before adding a seat arrangement.',
        CLIENT_HAS_ARRANGEMENT: 'This client already has a seat arrangement.',
        CLIENT_INACTIVE: 'Reactivate this client before enabling co-managed IT.',
        ARRANGEMENT_NOT_FOUND: 'Seat arrangement not found.',
        ARRANGEMENT_ENDED: 'This seat arrangement has ended.',
        INVALID_BOARD_SCOPE: 'List each board once.',
        BOARD_NOT_FOUND: 'A selected board is no longer available.',
      } satisfies Record<ArrangementCode, string>)[code]);
    this.name = 'CoManagedSeatArrangementError';
  }
}

export interface CoManagedSeatArrangement {
  arrangement_id: string;
  client_id: string;
  allocation_id: string;
  seats: number;
  state: 'active' | 'ended';
  revision: number;
}

export interface CreateCoManagedSeatArrangementInput {
  sponsorTenant: string;
  clientId: string;
  /** Idempotency key. It is also the allocation's operation id. */
  operationId: string;
  seats: number;
}

/**
 * Enables the seat shape for one client: takes the seats from the sponsor's pool and writes the
 * arrangement, in one transaction. Either both rows exist afterwards or neither does.
 *
 * Idempotent on `operationId`: a replay of the same request returns the arrangement as it now
 * stands, whatever has happened to the client or the pool since. The same id with different
 * details is an `OPERATION_CONFLICT`. Refusals are not recorded, so a refused request may be
 * retried under the same id.
 *
 * Refuses with `CLIENT_INACTIVE`, with `CLIENT_HAS_ARRANGEMENT` naming the live `workspace`
 * relationship or `seat` arrangement the client already has, and with every reason the seat
 * reservation refuses for (sponsor eligibility, lapse, capacity, unknown client).
 *
 * The sponsor's first arrangement also seeds the seat role (`admitCoManagedSeatRole`); a sponsor
 * with no seat arrangement never has it.
 *
 * Locks: the sponsor's entitlement row first, as every allocation writer does, then the client row.
 */
export async function createCoManagedSeatArrangement(
  db: Knex,
  input: CreateCoManagedSeatArrangementInput,
): Promise<CoManagedSeatArrangement> {
  if (![input.sponsorTenant, input.clientId, input.operationId].every((id) => uuid.test(id))) {
    throw new CoManagedSeatArrangementError('INVALID_RESERVATION');
  }

  return db.transaction(async (trx) => {
    const sponsor = tenantDb(trx, input.sponsorTenant);
    // The pool lock, taken before any other row so this command orders its locks the way the
    // reservation it composes does. The reservation re-reads the row inside this transaction.
    await sponsor.table('co_managed_entitlements').forUpdate().first('tenant');

    const replayed = await sponsor.table('co_managed_allocations')
      .where('operation_id', input.operationId).first('allocation_id');
    if (!replayed) {
      // Held to commit, so the client cannot be inactivated between this check and the insert.
      const client = await sponsor.table('clients').where('client_id', input.clientId).forShare().first('is_inactive');
      if (client?.is_inactive) throw new CoManagedSeatArrangementError('CLIENT_INACTIVE');
    }

    // Joins this transaction as a savepoint: the allocation commits only if the arrangement does.
    const allocation = await reserveAndActivateCoManagedSeatAllocation(trx, input).catch((error) => {
      if (error instanceof CoManagedReservationError) throw new CoManagedSeatArrangementError(error.code, error.existingKind);
      throw error;
    });

    const existing = await sponsor.table('co_managed_seat_arrangements')
      .where('allocation_id', allocation.allocation_id).first();
    if (existing) return arrangementResult(existing, allocation.seats);
    // The operation id belongs to seats taken outside this command; it is not this request's.
    if (replayed) throw new CoManagedSeatArrangementError('OPERATION_CONFLICT');

    // write-admission: exempt — seat arrangement lifecycle state, written by its owning command under the pool lock
    const [arrangement] = await sponsor.table('co_managed_seat_arrangements').insert({
      tenant: input.sponsorTenant,
      arrangement_id: randomUUID(),
      client_id: input.clientId,
      allocation_id: allocation.allocation_id,
      state: 'active',
    }).returning('*');
    // The role this arrangement's technicians will hold. Written by the sponsor's first
    // arrangement and found by every later one; the pool lock above makes that exactly one.
    await admitCoManagedSeatRole(trx, input.sponsorTenant);
    return arrangementResult(arrangement, allocation.seats);
  });
}

function arrangementResult(row: Omit<CoManagedSeatArrangement, 'seats'>, seats: number): CoManagedSeatArrangement {
  return {
    arrangement_id: row.arrangement_id, client_id: row.client_id, allocation_id: row.allocation_id,
    seats, state: row.state, revision: row.revision,
  };
}

/** One board in an arrangement's scope, and whether its technicians may create tickets there. */
export interface CoManagedSeatBoardScopeEntry {
  boardId: string;
  canCreate: boolean;
}

export interface SetCoManagedSeatBoardScopeInput {
  sponsorTenant: string;
  arrangementId: string;
  /** The whole scope. A board that is not listed leaves it; an empty list removes all ticket access. */
  boards: readonly CoManagedSeatBoardScopeEntry[];
}

/**
 * Sets an arrangement's board scope to exactly the boards given. Declarative, so repeating a
 * request changes nothing. Refuses an arrangement that does not exist or has ended, a board
 * listed twice, and a board the sponsor does not have.
 *
 * Locks the arrangement row; it never takes the pool lock.
 */
export async function setCoManagedSeatBoardScope(
  db: Knex,
  input: SetCoManagedSeatBoardScopeInput,
): Promise<CoManagedSeatBoardScopeEntry[]> {
  const boardIds = input.boards.map((board) => board.boardId);
  if (![input.sponsorTenant, input.arrangementId, ...boardIds].every((id) => uuid.test(id)) ||
      input.boards.some((board) => typeof board.canCreate !== 'boolean') ||
      new Set(boardIds.map((id) => id.toLowerCase())).size !== boardIds.length) {
    throw new CoManagedSeatArrangementError('INVALID_BOARD_SCOPE');
  }

  return db.transaction(async (trx) => {
    const sponsor = tenantDb(trx, input.sponsorTenant);
    const arrangement = await sponsor.table('co_managed_seat_arrangements')
      .where('arrangement_id', input.arrangementId).forUpdate().first('state');
    if (!arrangement) throw new CoManagedSeatArrangementError('ARRANGEMENT_NOT_FOUND');
    if (arrangement.state !== 'active') throw new CoManagedSeatArrangementError('ARRANGEMENT_ENDED');

    if (boardIds.length) {
      const boards = await sponsor.table('boards').whereIn('board_id', boardIds).forShare().select('board_id');
      if (boards.length !== boardIds.length) throw new CoManagedSeatArrangementError('BOARD_NOT_FOUND');
    }

    const scope = () => sponsor.table('co_managed_seat_board_scopes').where('arrangement_id', input.arrangementId);
    // write-admission: exempt — seat arrangement lifecycle state, written by its owning command under the arrangement lock
    await scope().whereNotIn('board_id', boardIds).del();
    if (input.boards.length) {
      // write-admission: exempt — seat arrangement lifecycle state, written by its owning command under the arrangement lock
      await sponsor.table('co_managed_seat_board_scopes').insert(input.boards.map((board) => ({
        tenant: input.sponsorTenant, arrangement_id: input.arrangementId,
        board_id: board.boardId, can_create: board.canCreate,
      }))).onConflict(['tenant', 'arrangement_id', 'board_id']).merge(['can_create']);
    }
    // write-admission: exempt — seat arrangement lifecycle state, written by its owning command under the arrangement lock
    await sponsor.table('co_managed_seat_arrangements').where('arrangement_id', input.arrangementId)
      .update({ revision: trx.raw('revision + 1'), updated_at: new Date() });

    return boardScopeResult(await scope().orderBy('board_id').select('board_id', 'can_create'));
  });
}

/**
 * The boards a live arrangement's technicians may work. Empty when the scope is empty and when
 * the arrangement does not exist or has ended: none of those grants any ticket access.
 */
export async function readCoManagedSeatBoardScope(
  db: Knex | Knex.Transaction,
  input: { sponsorTenant: string; arrangementId: string },
): Promise<CoManagedSeatBoardScopeEntry[]> {
  if (![input.sponsorTenant, input.arrangementId].every((id) => uuid.test(id))) return [];
  const sponsor = tenantDb(db, input.sponsorTenant);
  const arrangement = await sponsor.table('co_managed_seat_arrangements')
    .where({ arrangement_id: input.arrangementId, state: 'active' }).first('arrangement_id');
  if (!arrangement) return [];
  return boardScopeResult(await sponsor.table('co_managed_seat_board_scopes')
    .where('arrangement_id', input.arrangementId).orderBy('board_id').select('board_id', 'can_create'));
}

function boardScopeResult(rows: Array<{ board_id: string; can_create: boolean }>): CoManagedSeatBoardScopeEntry[] {
  return rows.map((row) => ({ boardId: row.board_id, canCreate: row.can_create }));
}

/** What a scope lets a technician do on a board: nothing, work its tickets, or also create them. */
export type CoManagedSeatBoardAccess = 'none' | 'work' | 'create';

/** A board that is not in the scope is closed; one that is in it admits creation only when flagged. */
export function coManagedSeatBoardAccess(
  scope: readonly CoManagedSeatBoardScopeEntry[],
  boardId: string,
): CoManagedSeatBoardAccess {
  const entry = scope.find((board) => board.boardId.toLowerCase() === boardId.toLowerCase());
  return !entry ? 'none' : entry.canCreate ? 'create' : 'work';
}
