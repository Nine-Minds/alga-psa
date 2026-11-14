/**
 * The principal half of co-managed write admission: a seat technician's writes.
 *
 * `co-managed-write-admission.ts` decides per TENANT, and only for a `co_managed` workspace. A seat
 * technician works in the sponsor's own (`psa`) tenant, so that gate never sees them; what makes
 * their writes lapse is the allocation behind their seat, on the pool's clock. This is the one
 * check for it. The authorization kernel's mutation boundary calls it (see `seatWriteAdmission.ts`
 * in `@alga-psa/co-managed`), so an action does not repeat it.
 *
 * Reads and sign-in never reach this: it is called for mutations only.
 *
 * Cost: one read of the user's live seat assignments, on the partial unique index. A user with none (every MSP user in a
 * tenant without seat arrangements) returns after that read and touches nothing else.
 */
import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { forcedValue } from '@alga-psa/core/capability';
import { CoManagedLifecycleError, type CoManagedOperationalState } from './co-managed-lifecycle-error';
import { readCoManagedSeatAllocationStateLockFree } from './co-managed-seat-allocation';

const TERMINATED: CoManagedOperationalState = { state: 'terminated', canWrite: false, graceEndsAt: null };

/**
 * Throws `CoManagedLifecycleError` when `userId` is a seat technician whose allocation has lapsed
 * past grace, or whose arrangement ended. Returns for anyone else.
 *
 * `FORCE_CAPABILITIES=co-managed-seat:off` admits every write, like the workspace kill switch.
 */
export async function assertCoManagedSeatTechnicianWrite(
  db: Knex | Knex.Transaction, tenant: string, userId: string,
): Promise<void> {
  if (!tenant || !userId) return;
  const forced = forcedValue(typeof process !== 'undefined' ? process.env.FORCE_CAPABILITIES : undefined, 'co-managed-seat');
  if (forced === 'off' || forced === 'malformed') return;
  const sponsor = tenantDb(db, tenant);
  // Non-revoked only: this is the `co_managed_one_live_seat_assignment (tenant, user_id)` index. A user
  // whose seats are all revoked is not a seat technician (S9 admits them as the MSP's own user), so
  // they, like every MSP user, return here.
  const live: { arrangement_id: string } | undefined = await sponsor.table('co_managed_seat_assignments')
    .where('user_id', userId).whereNot('state', 'revoked').first('arrangement_id');
  if (!live) return;
  const arrangement = await sponsor.table('co_managed_seat_arrangements')
    .where('arrangement_id', live.arrangement_id).first('state', 'allocation_id');
  if (!arrangement || arrangement.state !== 'active') throw new CoManagedLifecycleError(TERMINATED);
  const lifecycle = await readCoManagedSeatAllocationStateLockFree(db, tenant, arrangement.allocation_id);
  if (!lifecycle.canWrite) throw new CoManagedLifecycleError(lifecycle);
}
