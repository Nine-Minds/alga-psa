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
 * Cost: one indexed read of the user's seat assignments. A user with none (every MSP user in a
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
 * past grace, or whose seat has been ended or revoked. Returns for anyone else.
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
  const seats: Array<{ state: string; arrangement_id: string }> = await sponsor.table('co_managed_seat_assignments')
    .where('user_id', userId).select('state', 'arrangement_id');
  if (seats.length === 0) return;
  const live = seats.find((seat) => seat.state === 'active');
  // Only revoked seats remain: the arrangement ended or the seat was taken back, so the technician
  // is no longer anyone's to write as. The account is deactivated too; this covers a session that
  // outlives it until its next request.
  if (!live) throw new CoManagedLifecycleError(TERMINATED);
  const arrangement = await sponsor.table('co_managed_seat_arrangements')
    .where('arrangement_id', live.arrangement_id).first('state', 'allocation_id');
  if (!arrangement || arrangement.state !== 'active') throw new CoManagedLifecycleError(TERMINATED);
  const lifecycle = await readCoManagedSeatAllocationStateLockFree(db, tenant, arrangement.allocation_id);
  if (!lifecycle.canWrite) throw new CoManagedLifecycleError(lifecycle);
}
