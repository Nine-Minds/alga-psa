/**
 * Who consumes one of an MSP's licensed seats, and who does not.
 *
 * A licensed internal user is an active internal user who does not hold a live co-managed seat
 * assignment. A seat technician is an internal user of the sponsor tenant, but the seat is paid
 * for by the arrangement's allocation on the co-managed pool, so it never weighs on the MSP's own
 * `licensed_user_count`, solo-plan or appliance seat limit.
 *
 * This file is the one place that rule is written. Every licence count (the seat guard, licence
 * usage, the seat-reduction check, onboarding, the appliance seat check) reads through it, and
 * seat admission routes on it.
 *
 * "Live" is the definition the seat tables carry: an assignment that is not `revoked`
 * (`co_managed_one_live_seat_assignment`), whether still `invited` or already `active`.
 */
import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { readCoManagedSeatAllocationState } from './co-managed-seat-allocation';

type Db = Knex | Knex.Transaction;
type TenantScope = ReturnType<typeof tenantDb>;

const liveSeatAssignments = (scope: TenantScope) =>
  scope.table('co_managed_seat_assignments as seat_assignment').whereNot('seat_assignment.state', 'revoked');

const toCount = (row: { count?: string | number } | undefined): number => parseInt(String(row?.count ?? '0'), 10);

/**
 * The MSP's licensed internal users: active internal users without a live seat assignment.
 * For a tenant with no seat assignments this is exactly the active internal user count.
 */
export async function countLicensedInternalUsers(db: Db, tenant: string): Promise<number> {
  const scope = tenantDb(db, tenant);
  const row = await scope.table('users')
    .where({ 'users.user_type': 'internal', 'users.is_inactive': false })
    .whereNotExists(liveSeatAssignments(scope).select(db.raw('1')).whereRaw('seat_assignment.user_id = users.user_id'))
    .count('* as count').first();
  return toCount(row as { count?: string | number } | undefined);
}

/**
 * Pending invitations that reserve one of the MSP's licensed seats: unused, unexpired, and not a
 * seat technician's invitation (that one holds a seat of its arrangement instead). `excludeEmail`
 * leaves out the invitee being (re)invited so a resend never blocks itself.
 */
export async function countLicensedPendingInvitations(
  db: Db, tenant: string, options?: { excludeEmail?: string },
): Promise<number> {
  const scope = tenantDb(db, tenant);
  let query = scope.table('user_invitations')
    .whereNull('user_invitations.used_at')
    .where('user_invitations.expires_at', '>', db.fn.now())
    .whereNotExists(liveSeatAssignments(scope).select(db.raw('1'))
      .whereRaw('seat_assignment.invitation_id = user_invitations.invitation_id'));
  if (options?.excludeEmail !== undefined) query = query.whereNot('user_invitations.email', options.excludeEmail);
  return toCount(await query.count('* as count').first() as { count?: string | number } | undefined);
}

/**
 * The email's pending invitation (unused, unexpired), and whether it is a seat invitation: the
 * invitation of a seat technician, which holds a seat of its arrangement. The MSP's own invitation
 * flow never sends or refreshes a seat invitation (it would reserve an MSP seat and give the
 * technician a role); the seat flow owns it.
 *
 * One read for both answers: the MSP flow already reads the pending invitation it refreshes, so
 * asking about the seat costs a plain PSA invitation no extra query. Invitations are stored with
 * the trimmed, lower-cased email (both flows normalize on write), so the match is exact, the same
 * match the invitation service uses when it refreshes one.
 */
export async function findPendingInvitation(
  db: Db, tenant: string, email: string,
): Promise<{ invitationId: string; seatInvitation: boolean } | null> {
  const scope = tenantDb(db, tenant);
  const seat = liveSeatAssignments(scope).select(db.raw('1'))
    .whereRaw('seat_assignment.invitation_id = user_invitations.invitation_id');
  const row = await scope.table('user_invitations')
    .where('user_invitations.email', email.trim().toLowerCase())
    .whereNull('user_invitations.used_at')
    .where('user_invitations.expires_at', '>', db.fn.now())
    .select('user_invitations.invitation_id', db.raw('exists (?) as seat_invitation', [seat]))
    // A seat invitation first: should both ever be pending, the seat flow's claim decides.
    .orderBy('seat_invitation', 'desc')
    .first() as { invitation_id: string; seat_invitation: boolean } | undefined;
  return row ? { invitationId: row.invitation_id, seatInvitation: row.seat_invitation === true } : null;
}

/** Why a seat technician was refused. The allocation, not the MSP's licence, is what ran out. */
export type CoManagedSeatTechnicianRefusal = 'ARRANGEMENT_ENDED' | 'ENTITLEMENT_LAPSED' | 'SEAT_LIMIT';

export type CoManagedSeatTechnicianAdmission =
  /** Not a seat technician: the caller applies the MSP's own licensed seat limit. */
  | { seatTechnician: false }
  | { seatTechnician: true; ok: true; assignmentId: string; arrangementId: string }
  | { seatTechnician: true; ok: false; reason: CoManagedSeatTechnicianRefusal; error: string };

const REFUSALS: Record<CoManagedSeatTechnicianRefusal, string> = {
  ARRANGEMENT_ENDED: 'This seat arrangement has ended.',
  ENTITLEMENT_LAPSED: 'Restore the co-managed pool before activating this technician.',
  SEAT_LIMIT: 'Every seat in this arrangement is in use. Add seats before activating another technician.',
};

/**
 * Seat admission for a subject that is a seat technician: an existing user who holds a live seat
 * assignment (reactivation, directory provisioning), or the holder of a seat invitation
 * (creation on acceptance). Such a subject is admitted against the arrangement's allocation and
 * never against the MSP's licensed seat limit; the answer here is final either way.
 *
 * The subject already holds its seat (a live assignment is a committed seat from invitation on),
 * so this takes no further seat. It refuses when the arrangement has ended, when the pool is
 * lapsed (as every other seat admission), and when the arrangement's committed seats exceed its
 * allocation.
 *
 * Returns `{ seatTechnician: false }` without taking any lock when the subject holds no live
 * seat assignment, which is every admission in a tenant without seat arrangements.
 *
 * Locks. The caller already holds the tenant's internal-user seat lock. For a seat technician
 * this then takes the sponsor entitlement row, the allocation row and the arrangement row: the
 * same subsequence of the one total order (seat lock, entitlement, allocation, arrangement,
 * tenant) that seat invitation takes, so it cannot deadlock with it or with any capacity writer.
 */
export async function admitCoManagedSeatTechnician(
  trx: Knex.Transaction,
  tenant: string,
  subject: { existingUserId?: string; invitationToken?: string; email?: string },
): Promise<CoManagedSeatTechnicianAdmission> {
  const scope = tenantDb(trx, tenant);
  let held: { assignment_id: string; arrangement_id: string } | undefined;
  if (subject.existingUserId) {
    held = await liveSeatAssignments(scope).where('seat_assignment.user_id', subject.existingUserId)
      .first('seat_assignment.assignment_id', 'seat_assignment.arrangement_id');
  }
  if (!held && subject.invitationToken) {
    // The token is bound to the email it was issued for, as the workspace admission binds its own.
    const invitation = await scope.table('user_invitations')
      .where({ token: subject.invitationToken, used_at: null }).first('invitation_id', 'email');
    if (invitation && invitation.email.trim().toLowerCase() === subject.email?.trim().toLowerCase()) {
      held = await liveSeatAssignments(scope)
        .where({ 'seat_assignment.invitation_id': invitation.invitation_id, 'seat_assignment.state': 'invited' })
        .first('seat_assignment.assignment_id', 'seat_assignment.arrangement_id');
    }
  }
  if (!held) return { seatTechnician: false };
  const { assignment_id: assignmentId, arrangement_id: arrangementId } = held;

  const refuse = (reason: CoManagedSeatTechnicianRefusal): CoManagedSeatTechnicianAdmission =>
    ({ seatTechnician: true, ok: false, reason, error: REFUSALS[reason] });
  const arrangements = () => scope.table('co_managed_seat_arrangements').where('arrangement_id', arrangementId);

  // Unlocked: only to learn which allocation to lock. Re-read under its own lock below.
  const found = await arrangements().first('allocation_id');
  if (!found) return refuse('ARRANGEMENT_ENDED');
  // The pool, then the allocation, then the arrangement: the order seat invitation uses.
  const pool = await readCoManagedSeatAllocationState(trx, tenant, found.allocation_id);
  const arrangement = await arrangements().forUpdate().first('state', 'allocation_id');
  if (!arrangement || arrangement.state !== 'active' || arrangement.allocation_id !== found.allocation_id ||
      pool.state === 'terminated') return refuse('ARRANGEMENT_ENDED');
  if (pool.state !== 'active') return refuse('ENTITLEMENT_LAPSED');

  const allocation = await scope.table('co_managed_allocations')
    .where({ allocation_id: arrangement.allocation_id, allocation_kind: 'seat' }).first('seats');
  const committed = toCount(await liveSeatAssignments(scope)
    .where('seat_assignment.arrangement_id', arrangementId).count('* as count').first() as { count?: string | number } | undefined);
  if (committed > Number(allocation?.seats ?? 0)) return refuse('SEAT_LIMIT');

  return { seatTechnician: true, ok: true, assignmentId, arrangementId };
}
