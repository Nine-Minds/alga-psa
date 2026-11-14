import type { Knex } from 'knex';
import { assertSeatTechnicianWrite, tenantDb } from '@alga-psa/db';
import { UserSession } from '@alga-psa/db/models/UserSession';
import { readCoManagedSeatAllocationState } from '@alga-psa/licensing';
import { CO_MANAGED_SEAT_ROLE } from './seatRole';

/**
 * Ending a seat technician's assignment: revoking it, and converting the technician to an
 * ordinary MSP user. Both free the committed seat in the arrangement and both end the assignment
 * (`state = 'revoked'`, `revoked_at`); `ended_reason` records which, because admission must tell a
 * revoked technician (never reactivated as MSP staff) from a converted one (MSP staff).
 *
 * Internal commands with no entry point of their own; a caller must authorize sponsor
 * administration (and access to the client) before using them. Neither is reachable from a route,
 * action or menu in this slice.
 */

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type SeatEndCode = 'INVALID_REQUEST' | 'ASSIGNMENT_NOT_FOUND' | 'ASSIGNMENT_NOT_LIVE' | 'ROLE_REQUIRED' |
  'ROLE_NOT_ALLOWED' | 'MSP_SEAT_LIMIT';

export class CoManagedSeatEndError extends Error {
  /**
   * @param admissionCode Set with `MSP_SEAT_LIMIT`: the MSP seat limit that refused
   * (`SOLO_PLAN_LIMIT` or `LICENSE_LIMIT_REACHED`). The message is the admission's own.
   */
  constructor(public readonly code: SeatEndCode, message?: string, public readonly admissionCode?: string) {
    super(message ?? ({
      INVALID_REQUEST: 'Provide a seat assignment of this workspace.',
      ASSIGNMENT_NOT_FOUND: 'Seat assignment not found.',
      ASSIGNMENT_NOT_LIVE: 'This technician does not hold a seat.',
      ROLE_REQUIRED: 'Choose at least one role for the new MSP user.',
      ROLE_NOT_ALLOWED: 'Choose MSP roles other than the seat role.',
      MSP_SEAT_LIMIT: 'You have reached your MSP user license limit.',
    } satisfies Record<SeatEndCode, string>)[code]);
    this.name = 'CoManagedSeatEndError';
  }
}

export interface RevokeCoManagedSeatAssignmentInput {
  sponsorTenant: string;
  assignmentId: string;
  /** When given, the assignment must belong to this arrangement; anything else is `ASSIGNMENT_NOT_FOUND`. */
  arrangementId?: string;
}

export interface CoManagedSeatRevocation {
  assignment_id: string;
  arrangement_id: string;
  /** The deactivated technician; null for an invitation that was never accepted. */
  user_id: string | null;
  /** False when the assignment had already ended: nothing was written. */
  revoked: boolean;
  /** Sessions ended with the revocation. Zero for an invitation, and for a technician who was signed out. */
  sessions_revoked: number;
}

/** The seat role ids of a sponsor, by the identity admission seeds them under. */
const seatRoleIds = (trx: Knex.Transaction, sponsorTenant: string): Promise<string[]> =>
  tenantDb(trx, sponsorTenant).table('roles').where(CO_MANAGED_SEAT_ROLE).pluck('role_id');

interface LockedAssignment {
  assignment_id: string;
  arrangement_id: string;
  user_id: string | null;
  invitation_id: string | null;
  state: 'invited' | 'active' | 'revoked';
}

/**
 * Takes the locks `inviteCoManagedSeatTechnician` documents, in its order (seat lock, entitlement,
 * allocation, arrangement), then the assignment row, and returns the assignment as it stands under
 * them. Unlike invitation it reads no arrangement or pool state to refuse on: ending a seat must
 * work for an ended arrangement and a lapsed pool, which is when it is most needed.
 *
 * The caller's own transaction keeps every lock to commit.
 */
async function lockAssignment(
  trx: Knex.Transaction,
  sponsorTenant: string,
  match: { assignmentId: string; arrangementId?: string } | { userId: string },
): Promise<LockedAssignment | undefined> {
  const sponsor = tenantDb(trx, sponsorTenant);
  // (1) LEVERAGE: pattern internal-user-seat-lock — fourth copy of lockInternalUserSeats (see inviteCoManagedSeatTechnician).
  await trx.raw('SELECT pg_advisory_xact_lock(hashtext(?), hashtext(?))', ['internal_user_seats', sponsorTenant]);

  // Unlocked: only to learn which arrangement and allocation to lock. Re-read under lock below.
  const assignments = () => {
    const query = sponsor.table('co_managed_seat_assignments');
    if ('userId' in match) return query.where('user_id', match.userId).whereNot('state', 'revoked');
    return query.where('assignment_id', match.assignmentId);
  };
  const found = await assignments().first('assignment_id', 'arrangement_id');
  if (!found || ('arrangementId' in match && match.arrangementId && found.arrangement_id !== match.arrangementId)) return undefined;
  const arrangements = () => sponsor.table('co_managed_seat_arrangements').where('arrangement_id', found.arrangement_id);
  const arrangement = await arrangements().first('allocation_id');
  if (!arrangement) return undefined;

  // (2) and (3): the pool, then the allocation. The state it answers is not a reason to refuse here.
  await readCoManagedSeatAllocationState(trx, sponsorTenant, arrangement.allocation_id);
  // (4)
  await arrangements().forUpdate().first('state');
  const locked: LockedAssignment | undefined = await sponsor.table('co_managed_seat_assignments')
    .where('assignment_id', found.assignment_id).forUpdate()
    .first('assignment_id', 'arrangement_id', 'user_id', 'invitation_id', 'state');
  return locked && locked.arrangement_id === found.arrangement_id ? locked : undefined;
}

/**
 * Ends an assignment and everything that hangs on it being live, in the caller's transaction:
 * the assignment, an unspent invitation, and `users.seat_reader`. The committed-seat count
 * `inviteCoManagedSeatTechnician` tests against `SEAT_LIMIT` is the assignments that are not
 * `revoked`, so the seat is free the moment this returns.
 */
async function endAssignment(
  trx: Knex.Transaction,
  sponsorTenant: string,
  assignment: LockedAssignment,
  reason: 'revoked' | 'converted',
): Promise<void> {
  const sponsor = tenantDb(trx, sponsorTenant);
  const now = new Date();
  // write-admission: exempt — seat assignment lifecycle state, written by its owning command under the pool and arrangement locks
  await sponsor.table('co_managed_seat_assignments').where('assignment_id', assignment.assignment_id)
    .update({ state: 'revoked', revoked_at: now, ended_reason: reason, updated_at: now });

  if (assignment.invitation_id) {
    // Spent, so the setup token opens nothing and the address is promised to no one. Acceptance
    // already refuses a revoked assignment; this makes the invitation row say the same.
    // write-admission: exempt — seat invitation, spent by its owning command under the pool and arrangement locks
    await sponsor.table('user_invitations').where('invitation_id', assignment.invitation_id).whereNull('used_at')
      .update({ used_at: now });
  }

  if (assignment.user_id) {
    // The marker says "bound by a live assignment" (20261113130000). Plain Postgres has a trigger
    // for this; Citus has none, so the command clears it itself: only when this was the user's last
    // binding assignment, and after the assignment ended, which is what the foreign key requires.
    const stillBound = await sponsor.table('co_managed_seat_assignments')
      .where('user_id', assignment.user_id).whereNot('state', 'revoked').first('assignment_id');
    if (!stillBound) {
      await sponsor.table('users').where({ user_id: assignment.user_id, seat_reader: true }).update({ seat_reader: false });
    }
  }
}

/**
 * Revokes a seat assignment: the technician loses the seat, immediately and for good.
 *
 * In one transaction, under the locks of `inviteCoManagedSeatTechnician` (seat lock, entitlement,
 * allocation, arrangement) and then the assignment row:
 *
 * - The assignment becomes `revoked` with `revoked_at` and `ended_reason = 'revoked'`. The seat is
 *   free: a new invitation to the arrangement fits where `SEAT_LIMIT` refused before.
 * - An assignment still `invited` has its invitation spent, so the token cannot be accepted.
 * - A technician is deactivated (`is_inactive = true`), loses every role row (the seat role, and any
 *   other that predates the role guard), and has `users.seat_reader` cleared. Every session they
 *   hold is revoked in the same transaction.
 *
 * "Next request": `getCurrentUser` rejects an inactive user on every request, so the deactivation
 * alone ends access on the technician's next request; revoking the sessions as well means no
 * session survives to be reused if the user were ever reactivated, and it commits with the
 * deactivation, never after it.
 *
 * No ordinary internal user is left behind. The user is inactive with no role, and admission
 * refuses to reactivate them (`SEAT_REVOKED` in `admitCoManagedSeatTechnician`, which every
 * reactivation path calls). A technician who should become MSP staff is converted
 * (`convertCoManagedSeatTechnicianToMspUser`) while they still hold the seat.
 *
 * Idempotent: an assignment that has already ended is left as it is and reported with
 * `revoked: false`. An assignment of another tenant, or of another arrangement than the one named,
 * is `ASSIGNMENT_NOT_FOUND`.
 */
export async function revokeCoManagedSeatAssignment(
  db: Knex,
  input: RevokeCoManagedSeatAssignmentInput,
): Promise<CoManagedSeatRevocation> {
  if (![input.sponsorTenant, input.assignmentId, ...(input.arrangementId === undefined ? [] : [input.arrangementId])]
        .every((id) => typeof id === 'string' && uuid.test(id))) {
    throw new CoManagedSeatEndError('INVALID_REQUEST');
  }

  return db.transaction(async (trx) => {
    const assignment = await lockAssignment(trx, input.sponsorTenant, input);
    if (!assignment) throw new CoManagedSeatEndError('ASSIGNMENT_NOT_FOUND');
    const result = {
      assignment_id: assignment.assignment_id, arrangement_id: assignment.arrangement_id,
      user_id: assignment.user_id, revoked: false, sessions_revoked: 0,
    };
    if (assignment.state === 'revoked') return result;

    await endAssignment(trx, input.sponsorTenant, assignment, 'revoked');
    if (!assignment.user_id) return { ...result, revoked: true };

    const sponsor = tenantDb(trx, input.sponsorTenant);
    await sponsor.table('users').where('user_id', assignment.user_id).update({ is_inactive: true, updated_at: new Date() });
    await sponsor.table('user_roles').where('user_id', assignment.user_id).del();
    const sessions = await UserSession.revokeAllForUser(input.sponsorTenant, assignment.user_id, trx);
    return { ...result, revoked: true, sessions_revoked: sessions };
  });
}

/** What a conversion needs of the MSP's own seat admission. See `mspSeatAdmissionForConversion` in `@alga-psa/users`. */
export interface MspSeatAdmission {
  /** Resolves `{ ok: false }` with the limit that refused, or `{ ok: true }`. Run before the assignment ends. */
  admit(trx: Knex.Transaction, tenant: string): Promise<{ ok: true } | { ok: false; code: string; error: string }>;
  /** The post-write tripwire: throws when the write left the tenant over its limit. */
  assertWithinLimit(trx: Knex.Transaction, tenant: string, admitted: { ok: true }): Promise<void>;
}

export interface ConvertCoManagedSeatTechnicianInput {
  sponsorTenant: string;
  /** The technician, by assignment or by user. One of the two. */
  assignmentId?: string;
  userId?: string;
  /** The MSP roles the user holds afterwards: at least one, none of them the seat role. */
  roleIds: readonly string[];
  /**
   * The MSP's seat admission, `mspSeatAdmissionForConversion` from `@alga-psa/users`. Passed in
   * because the count and limits live in that vertical package, which this one cannot import.
   */
  seatAdmission: MspSeatAdmission;
}

export interface CoManagedSeatConversion {
  assignment_id: string;
  arrangement_id: string;
  user_id: string;
  role_ids: string[];
  sessions_revoked: number;
}

/**
 * Converts a seat technician into an ordinary MSP user: they stop being a seat technician and
 * start consuming one of the MSP's own licensed seats.
 *
 * Admission first. While the assignment is live the technician is excluded from
 * `countLicensedInternalUsers`, so the MSP's seat check (`seatAdmission.admit`, S9's
 * `admitInternalUserSeat` with no subject) reads exactly the seats everyone else holds and asks
 * whether one more fits. At the limit it refuses with `MSP_SEAT_LIMIT` (and the limit's own code
 * in `admissionCode`) and the transaction rolls back: nothing changes.
 *
 * With a seat free, in one transaction: the assignment ends (`revoked`, `ended_reason =
 * 'converted'`) and the arrangement's seat is free; `users.seat_reader` is cleared; every role row
 * is replaced by `roleIds`; the user is active; the post-write tripwire recounts the licensed seats.
 * The sessions are revoked in the same transaction, so the next request runs under the new roles
 * and a sign-in rather than the seat authority the old session was minted under.
 *
 * Ordering is the guard: the assignment ends before the roles are written, so `assertSeatTechnicianWrite`
 * (run before the write, as in every role writer) sees an ordinary user and needs no bypass.
 *
 * Refuses with `ROLE_REQUIRED` (no role), `ROLE_NOT_ALLOWED` (a role that is not one of this
 * sponsor's MSP roles, or is the seat role), `ASSIGNMENT_NOT_FOUND` and `ASSIGNMENT_NOT_LIVE` (it
 * has ended, or was never accepted and has no user to convert). Locks as `revokeCoManagedSeatAssignment`.
 */
export async function convertCoManagedSeatTechnicianToMspUser(
  db: Knex,
  input: ConvertCoManagedSeatTechnicianInput,
): Promise<CoManagedSeatConversion> {
  const named = [input.assignmentId, input.userId].filter((id) => id !== undefined);
  const roleIds = Array.isArray(input.roleIds) ? Array.from(new Set(input.roleIds)) : [];
  if (named.length !== 1 || ![input.sponsorTenant, ...named].every((id) => typeof id === 'string' && uuid.test(id))) {
    throw new CoManagedSeatEndError('INVALID_REQUEST');
  }
  if (roleIds.length === 0) throw new CoManagedSeatEndError('ROLE_REQUIRED');
  if (!roleIds.every((id) => typeof id === 'string' && uuid.test(id))) throw new CoManagedSeatEndError('ROLE_NOT_ALLOWED');

  return db.transaction(async (trx) => {
    const sponsor = tenantDb(trx, input.sponsorTenant);
    const assignment = await lockAssignment(trx, input.sponsorTenant,
      input.assignmentId ? { assignmentId: input.assignmentId } : { userId: input.userId as string });
    if (!assignment) throw new CoManagedSeatEndError(input.userId ? 'ASSIGNMENT_NOT_LIVE' : 'ASSIGNMENT_NOT_FOUND');
    if (assignment.state === 'revoked' || !assignment.user_id) throw new CoManagedSeatEndError('ASSIGNMENT_NOT_LIVE');
    const userId = assignment.user_id;

    // Only this sponsor's MSP roles, and never the seat role.
    const allowed = await sponsor.table('roles').whereIn('role_id', roleIds as string[])
      .where({ msp: true, client: false })
      .whereRaw('NOT (role_name = ?)', [CO_MANAGED_SEAT_ROLE.role_name]).pluck('role_id');
    if (allowed.length !== roleIds.length) throw new CoManagedSeatEndError('ROLE_NOT_ALLOWED');
    const user = await sponsor.table('users').where('user_id', userId).forUpdate().first('user_type');
    if (user?.user_type !== 'internal') throw new CoManagedSeatEndError('ASSIGNMENT_NOT_LIVE');

    // Before the assignment ends: the technician is still outside the licensed count.
    const admission = await input.seatAdmission.admit(trx, input.sponsorTenant);
    if (admission.ok !== true) {
      // Cast: ee/server typechecks this package with strictNullChecks off, where `ok` does not narrow.
      const refusal = admission as { ok: false; code: string; error: string };
      throw new CoManagedSeatEndError('MSP_SEAT_LIMIT', refusal.error, refusal.code);
    }

    await endAssignment(trx, input.sponsorTenant, assignment, 'converted');
    // Now an ordinary user: the guard that held the seat role in place has nothing to refuse.
    await assertSeatTechnicianWrite(trx, input.sponsorTenant, [userId], { roleIds });
    await sponsor.table('user_roles').where('user_id', userId).del();
    await sponsor.table('user_roles').insert(roleIds.map((roleId) => ({ tenant: input.sponsorTenant, user_id: userId, role_id: roleId })));
    await sponsor.table('users').where('user_id', userId).update({ is_inactive: false, updated_at: new Date() });
    await input.seatAdmission.assertWithinLimit(trx, input.sponsorTenant, admission);

    const sessions = await UserSession.revokeAllForUser(input.sponsorTenant, userId, trx);
    return {
      assignment_id: assignment.assignment_id, arrangement_id: assignment.arrangement_id,
      user_id: userId, role_ids: roleIds, sessions_revoked: sessions,
    };
  });
}
