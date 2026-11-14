import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';

/** The two shapes an allocation on the pool can take. */
export type CoManagedAllocationKind = 'workspace' | 'seat';

/** One reading of a sponsor's seat pool. `allocated` is the sum of `byKind`. */
export interface CoManagedPoolCapacity {
  /** Seats the pool is sized at for this reading. */
  purchased: number;
  /** Seats held by allocations that are not released, of either kind. */
  allocated: number;
  /** Seats left to allocate; never negative, even when the pool is over-allocated. */
  available: number;
  byKind: Record<CoManagedAllocationKind, number>;
}

/**
 * The single reading of a sponsor's seat pool. Every path that needs to know how much of the pool
 * is in use — entitlement state, purchases, reservations — reads it here.
 *
 * `purchased` is the pool size the caller has already resolved: the entitlement's effective
 * capacity, or the target a purchase proposes. Resolving it stays with the caller because it
 * depends on locks and a clock this reading must not take.
 *
 * Runs in the caller's transaction and takes no locks. A caller that needs the reading to hold
 * still must hold the sponsor entitlement row lock, as allocation writers do.
 */
export async function readCoManagedPoolCapacity(
  trx: Knex.Transaction,
  sponsor: string,
  purchased: number,
): Promise<CoManagedPoolCapacity> {
  const rows: Array<{ allocation_kind: CoManagedAllocationKind; used: string | number | null }> =
    await tenantDb(trx, sponsor).table('co_managed_allocations')
      .whereNot('state', 'released').groupBy('allocation_kind')
      .select('allocation_kind').sum('seats as used');
  const byKind: Record<CoManagedAllocationKind, number> = { workspace: 0, seat: 0 };
  for (const row of rows) byKind[row.allocation_kind] += Number(row.used ?? 0);
  const allocated = byKind.workspace + byKind.seat;
  return { purchased, allocated, available: Math.max(0, purchased - allocated), byKind };
}
