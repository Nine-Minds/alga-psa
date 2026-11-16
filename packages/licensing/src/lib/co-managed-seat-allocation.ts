/**
 * The modify, end and degrade half of a seat-kind allocation's life on the co-managed pool.
 *
 * A seat allocation takes seats for one of the sponsor's own clients. It has no customer tenant
 * and no relationship, so nothing here enters the customer locking path that a workspace
 * allocation uses. Every command takes the sponsor entitlement row lock first, as every other
 * capacity writer does, and reads the pool through `readCoManagedPoolCapacity` (by way of the
 * entitlement state), so a seat and a workspace weigh on one pool and lapse on one clock.
 *
 * Internal licensing primitives: the caller authorizes sponsor administration.
 */
import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { CoManagedAdmissionError } from './co-managed-admission';
import { materializeState, type CoManagedEntitlementState } from './co-managed-entitlements';
import type { CoManagedOperationalState } from './co-managed-lifecycle-error';
import { coManagedStateForLapse, resolveCoManagedLapse } from './co-managed-lifecycle';
import type { CoManagedSeatAllocationRecord } from './co-managed-reservation';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const validSeats = (seats: number) => Number.isSafeInteger(seats) && seats >= 1 && seats <= 2147483647;

/** A seat-kind row of `co_managed_allocations`, as the commands here read it. */
export type CoManagedSeatAllocationSnapshot = Pick<CoManagedSeatAllocationRecord,
  'allocation_id' | 'sponsor_client_id' | 'seats' | 'state'>;

/**
 * Counts the seats in use inside one seat allocation: active technicians plus pending
 * invitations. The owner of seat assignments supplies it; licensing does not know those tables.
 * It runs in the resize transaction, after the sponsor entitlement and the allocation row are
 * locked, so the count cannot move under the decision as long as seat admission takes the same
 * entitlement lock.
 */
export type CountCoManagedSeatCommitments = (
  trx: Knex.Transaction, allocation: CoManagedSeatAllocationSnapshot,
) => Promise<number>;

/** Locks the pool, then the live seat allocation. Entitlement first: the order every capacity writer uses. */
async function lockSeatAllocation(trx: Knex.Transaction, sponsorTenant: string, allocationId: string) {
  const sponsor = tenantDb(trx, sponsorTenant);
  const entitlement = await sponsor.table('co_managed_entitlements').forUpdate().first();
  const allocation: CoManagedSeatAllocationSnapshot | undefined = await sponsor.table('co_managed_allocations')
    .where({ allocation_id: allocationId, allocation_kind: 'seat' }).forUpdate()
    .first('allocation_id', 'sponsor_client_id', 'seats', 'state');
  return { sponsor, entitlement, allocation };
}

/** The pool as it stands now, with the durable lapse columns brought up to date. Null when the sponsor has no entitlement. */
async function poolState(trx: Knex.Transaction, sponsorTenant: string, entitlement: unknown): Promise<CoManagedEntitlementState | null> {
  return entitlement ? materializeState(trx, sponsorTenant, entitlement, new Date()) : null;
}

/**
 * Changes how many seats a seat allocation holds.
 *
 * A raise must fit in what the pool has available and is refused while the pool is lapsed. A
 * reduction stops at the allocation's committed seats: it never evicts a technician or cancels an
 * invitation to make the numbers fit. A reduction is allowed during a lapse, since giving seats
 * back is how an over-allocated pool recovers.
 *
 * `expectedSeats` is the size the caller last saw; a concurrent change is a conflict, not a
 * silent overwrite.
 */
// LEVERAGE: pattern co-managed-allocation-resize — same rule as changeCoManagedAllocation (expected size, committed floor, available ceiling, no raise while lapsed); only the lock path and the committed count differ by kind.
export async function resizeCoManagedSeatAllocation(db: Knex, sponsorTenant: string, input: {
  allocationId: string; seats: number; expectedSeats: number; countCommittedSeats: CountCoManagedSeatCommitments;
}): Promise<void> {
  if (!UUID.test(sponsorTenant) || !UUID.test(input.allocationId) || !validSeats(input.seats) || !validSeats(input.expectedSeats)) {
    throw new CoManagedAdmissionError('CO_MANAGED_ALLOCATION_CONFLICT');
  }
  await db.transaction(async (trx) => {
    const { sponsor, entitlement, allocation } = await lockSeatAllocation(trx, sponsorTenant, input.allocationId);
    if (!allocation || allocation.state === 'released' || Number(allocation.seats) !== input.expectedSeats) {
      throw new CoManagedAdmissionError('CO_MANAGED_ALLOCATION_CONFLICT');
    }
    if (input.seats === input.expectedSeats) return;
    if (input.seats > input.expectedSeats) {
      const pool = await poolState(trx, sponsorTenant, entitlement);
      if (!pool || pool.graceEndsAt || pool.isReadOnly) throw new CoManagedAdmissionError('CO_MANAGED_LICENSE_LAPSED');
      if (pool.available < input.seats - input.expectedSeats) throw new CoManagedAdmissionError('CO_MANAGED_POOL_LIMIT');
    } else if (await input.countCommittedSeats(trx, { ...allocation, seats: Number(allocation.seats) }) > input.seats) {
      throw new CoManagedAdmissionError('CO_MANAGED_SEAT_LIMIT');
    }
    // write-admission: exempt — seat allocation lifecycle owned by licensing; it decides admission rather than being subject to it
    await sponsor.table('co_managed_allocations').where({ allocation_id: allocation.allocation_id, allocation_kind: 'seat' })
      .whereNot('state', 'released').update({ seats: input.seats, updated_at: trx.fn.now() });
    // Seats given back may end an over-allocation; record that now rather than at the next reading.
    if (input.seats < input.expectedSeats) await poolState(trx, sponsorTenant, entitlement);
  });
}

/**
 * Returns a seat allocation's seats to the pool.
 *
 * Exactly once: the release is an update-if-not-released, so a replay, a retry or a concurrent
 * second caller changes nothing and reports `released: false`. Only an allocation that never
 * existed for this sponsor as a seat allocation is a conflict.
 *
 * This is the pool half only. Ending the arrangement and revoking its technicians belong to the
 * caller, before it releases.
 */
export async function releaseCoManagedSeatAllocation(db: Knex, sponsorTenant: string, input: {
  allocationId: string;
}): Promise<{ released: boolean; seats: number }> {
  if (!UUID.test(sponsorTenant) || !UUID.test(input.allocationId)) throw new CoManagedAdmissionError('CO_MANAGED_ALLOCATION_CONFLICT');
  return db.transaction(async (trx) => {
    const { sponsor, entitlement, allocation } = await lockSeatAllocation(trx, sponsorTenant, input.allocationId);
    if (!allocation) throw new CoManagedAdmissionError('CO_MANAGED_ALLOCATION_CONFLICT');
    // write-admission: exempt — seat allocation lifecycle owned by licensing; it decides admission rather than being subject to it
    const freed: Array<{ seats: number }> = await sponsor.table('co_managed_allocations')
      .where({ allocation_id: allocation.allocation_id, allocation_kind: 'seat' }).whereNull('released_at').whereNot('state', 'released')
      .update({ state: 'released', released_at: trx.fn.now(), updated_at: trx.fn.now() }).returning('seats');
    if (freed.length === 0) return { released: false, seats: 0 };
    // The returned seats may end an over-allocation; record that now rather than at the next reading.
    await poolState(trx, sponsorTenant, entitlement);
    return { released: true, seats: Number(freed[0].seats) };
  });
}

/**
 * Where a seat allocation stands, on the pool's clock.
 *
 * The lapse belongs to the pool, not to an allocation: capacity below what both kinds hold starts
 * one grace window, and every live allocation of either kind follows its one deadline. This reads
 * that deadline for a seat allocation exactly as the workspace lifecycle reads it for a workspace.
 *
 * Takes the sponsor entitlement row lock; the caller keeps the transaction through any write it
 * admits on the answer.
 */
export async function readCoManagedSeatAllocationState(
  trx: Knex.Transaction, sponsorTenant: string, allocationId: string,
): Promise<CoManagedOperationalState> {
  const { entitlement, allocation } = await lockSeatAllocation(trx, sponsorTenant, allocationId);
  if (!allocation || allocation.state === 'released') return { state: 'terminated', canWrite: false, graceEndsAt: null };
  if (allocation.state !== 'active') return { state: 'pending_acceptance', canWrite: false, graceEndsAt: null };
  // No entitlement row: capacity is zero, which the workspace lifecycle also reads as read-only.
  if (!entitlement) return { state: 'read_only', canWrite: false, graceEndsAt: null };
  const pool = await materializeState(trx, sponsorTenant, entitlement, new Date());
  if (pool.isReadOnly) return { state: 'read_only', canWrite: false, graceEndsAt: pool.graceEndsAt };
  return { state: pool.graceEndsAt ? 'grace' : 'active', canWrite: true, graceEndsAt: pool.graceEndsAt };
}

/**
 * The same answer as `readCoManagedSeatAllocationState`, for a write gate that runs on every
 * mutation of a seat technician: no row lock and no write. It reads the durable lapse columns the
 * pool already stored, exactly as `readCoManagedLifecycleLockFree` does for a workspace, so it may
 * be briefly staler than the locked reader (a lapse that has begun but not yet been recorded reads
 * as healthy until the next capacity writer or reading records it) but never takes a lock a
 * capacity writer holds.
 */
export async function readCoManagedSeatAllocationStateLockFree(
  db: Knex | Knex.Transaction, sponsorTenant: string, allocationId: string, now: () => Date = () => new Date(),
): Promise<CoManagedOperationalState> {
  const sponsor = tenantDb(db, sponsorTenant);
  const allocation = await sponsor.table('co_managed_allocations')
    .where({ allocation_id: allocationId, allocation_kind: 'seat' }).first('state');
  if (!allocation || allocation.state === 'released') return { state: 'terminated', canWrite: false, graceEndsAt: null };
  if (allocation.state !== 'active') return { state: 'pending_acceptance', canWrite: false, graceEndsAt: null };
  const entitlement = await sponsor.table('co_managed_entitlements').first('lapse_started_at', 'valid_until');
  if (!entitlement) return { state: 'read_only', canWrite: false, graceEndsAt: null };
  const at = now();
  // An entitlement that expired but has not been re-materialized yet lapses at its expiry.
  const expired = entitlement.valid_until && new Date(entitlement.valid_until).getTime() <= at.getTime();
  const lapseStartedAt = entitlement.lapse_started_at ?? (expired ? entitlement.valid_until : null);
  return coManagedStateForLapse(resolveCoManagedLapse({ lapseStartedAt, now: at }));
}
