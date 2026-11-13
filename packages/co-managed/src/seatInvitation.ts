import { randomBytes, randomUUID } from 'node:crypto';
import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import User from '@alga-psa/db/models/user';
import { readCoManagedSeatAllocationState, type CountCoManagedSeatCommitments } from '@alga-psa/licensing';

/**
 * Seat invitations: a technician of one of the sponsor's clients, invited by name and email into
 * that client's seat arrangement and admitted against the arrangement's allocation, never against
 * the sponsor's own licensed seats.
 *
 * Internal commands with no entry point of their own; a caller must authorize sponsor
 * administration and access to the client before using them.
 */

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const emailShape = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const EMAIL_CLAIM_REASON = 'internal user emails are unique across tenants, including pending invitations';

type InvitationCode = 'INVALID_INVITATION' | 'ARRANGEMENT_NOT_FOUND' | 'ARRANGEMENT_ENDED' | 'ENTITLEMENT_LAPSED' |
  'EMAIL_IN_USE' | 'EMAIL_INVITED' | 'SEAT_LIMIT';

export class CoManagedSeatInvitationError extends Error {
  constructor(public readonly code: InvitationCode) {
    super(({
      INVALID_INVITATION: 'Provide a name and a valid email address.',
      ARRANGEMENT_NOT_FOUND: 'Seat arrangement not found.',
      ARRANGEMENT_ENDED: 'This seat arrangement has ended.',
      ENTITLEMENT_LAPSED: 'Restore the co-managed pool before inviting a technician.',
      EMAIL_IN_USE: 'This email address already belongs to a user account. Use a different address.',
      EMAIL_INVITED: 'This email address already has a pending invitation.',
      SEAT_LIMIT: 'Every seat in this arrangement is in use. Add seats before inviting another technician.',
    } satisfies Record<InvitationCode, string>)[code]);
    this.name = 'CoManagedSeatInvitationError';
  }
}

export interface InviteCoManagedSeatTechnicianInput {
  sponsorTenant: string;
  arrangementId: string;
  email: string;
  firstName: string;
  lastName?: string;
  /** The sponsor user who sent the invitation, when there is one. */
  invitedBy?: string;
}

export interface CoManagedSeatInvitation {
  assignment_id: string;
  arrangement_id: string;
  invitation_id: string;
  email: string;
  state: 'invited';
  /** The setup token. The caller delivers it after this command commits, never inside it. */
  token: string;
  /** False when the technician already held this invitation; no further seat was taken. */
  created: boolean;
}

/**
 * The seats in use inside one arrangement: active technicians plus pending invitations. An
 * invitation holds its seat until it is accepted or revoked, whether or not its link has expired.
 */
const liveAssignments = (trx: Knex.Transaction, sponsorTenant: string) =>
  tenantDb(trx, sponsorTenant).table('co_managed_seat_assignments').whereNot('state', 'revoked');

async function count(query: Knex.QueryBuilder): Promise<number> {
  return Number((await query.count('* as count').first())?.count ?? 0);
}

/**
 * The committed-seat count a seat allocation's resize stops at (`resizeCoManagedSeatAllocation`).
 * It runs under the entitlement lock invitation takes, so the count cannot move under a resize.
 */
export function coManagedSeatCommitmentCounter(sponsorTenant: string): CountCoManagedSeatCommitments {
  return async (trx, allocation) => {
    const arrangements = tenantDb(trx, sponsorTenant).table('co_managed_seat_arrangements')
      .where('allocation_id', allocation.allocation_id).select('arrangement_id');
    return count(liveAssignments(trx, sponsorTenant).whereIn('arrangement_id', arrangements));
  };
}

/**
 * Invites a technician into a seat arrangement. The assignment is recorded as `invited` and holds
 * one of the arrangement's seats from this moment; nobody can sign in until it is accepted.
 *
 * Declarative on the email: inviting a technician who already holds a pending invitation to this
 * arrangement returns that invitation and takes no further seat.
 *
 * Refuses with `ARRANGEMENT_NOT_FOUND`, `ARRANGEMENT_ENDED`, `ENTITLEMENT_LAPSED` (lapse grace or
 * read-only, as every other seat admission), `EMAIL_IN_USE` (an internal user anywhere on the
 * platform already signs in with it), `EMAIL_INVITED` (it is promised to a pending invitation or
 * workspace setup) and `SEAT_LIMIT` (committed seats would exceed the allocation).
 *
 * Locks, in this order and no other:
 *
 *   1. the sponsor's internal-user seat lock (advisory, per tenant),
 *   2. the sponsor's entitlement row,
 *   3. the seat allocation row,
 *   4. the arrangement row,
 *   5. the sponsor's `tenants` row (KEY SHARE, taken by the invitation insert's foreign key).
 *
 * Why this cannot deadlock. A deadlock needs two transactions that each hold a lock the other is
 * waiting for, so it needs two of these locks taken in opposite orders somewhere. None are:
 *
 * - Reservation, arrangement creation, resize, release, purchase (its second transaction) and
 *   hosted reconcile all take the entitlement row first and never take the seat lock, so against
 *   them (1) is uncontended and everything after it is ordered behind (2). Whichever holds (2)
 *   runs to commit; it waits for nothing an invitation can hold, because an invitation holds
 *   (3) to (5) only after it holds (2).
 * - Purchase and reservation also lock the `tenants` row, after the entitlement row: the same
 *   order as (2) then (5). Purchase's first transaction locks `tenants` alone and waits for no
 *   other lock.
 * - Board scope locks the arrangement row alone.
 * - The internal-user paths (create, invite, reactivate) take the seat lock first and then row
 *   locks, never the reverse, and they do not take this tenant's entitlement row.
 *
 * The total order is therefore: seat lock, entitlement, allocation, arrangement, tenant. Every
 * command takes a subsequence of it.
 */
export async function inviteCoManagedSeatTechnician(
  db: Knex,
  input: InviteCoManagedSeatTechnicianInput,
): Promise<CoManagedSeatInvitation> {
  const email = typeof input.email === 'string' ? input.email.trim().toLowerCase() : '';
  const firstName = typeof input.firstName === 'string' ? input.firstName.trim() : '';
  const lastName = typeof input.lastName === 'string' ? input.lastName.trim() : '';
  if (![input.sponsorTenant, input.arrangementId, ...(input.invitedBy === undefined ? [] : [input.invitedBy])]
        .every((id) => typeof id === 'string' && uuid.test(id)) ||
      !emailShape.test(email) || !firstName) {
    throw new CoManagedSeatInvitationError('INVALID_INVITATION');
  }

  return db.transaction(async (trx) => {
    const sponsor = tenantDb(trx, input.sponsorTenant);
    const arrangements = () => sponsor.table('co_managed_seat_arrangements').where('arrangement_id', input.arrangementId);

    // (1) The invitation is an internal-user invitation of this tenant, so it joins the order
    // every internal-user seat path uses: the seat lock before any row lock.
    // LEVERAGE: pattern internal-user-seat-lock — same statement as lockInternalUserSeats in @alga-psa/users, which this package cannot import; the lock belongs in a layer both can reach.
    await trx.raw('SELECT pg_advisory_xact_lock(hashtext(?), hashtext(?))', ['internal_user_seats', input.sponsorTenant]);

    // Unlocked: only to learn which allocation to lock. Re-read under its own lock below.
    const found = await arrangements().first('allocation_id');
    if (!found) throw new CoManagedSeatInvitationError('ARRANGEMENT_NOT_FOUND');

    // (2) and (3): the pool, then the allocation, as every capacity writer locks them.
    const pool = await readCoManagedSeatAllocationState(trx, input.sponsorTenant, found.allocation_id);
    // (4)
    const arrangement = await arrangements().forUpdate().first('state', 'allocation_id');
    if (!arrangement) throw new CoManagedSeatInvitationError('ARRANGEMENT_NOT_FOUND');
    if (arrangement.state !== 'active' || arrangement.allocation_id !== found.allocation_id || pool.state === 'terminated') {
      throw new CoManagedSeatInvitationError('ARRANGEMENT_ENDED');
    }
    if (pool.state !== 'active') throw new CoManagedSeatInvitationError('ENTITLEMENT_LAPSED');

    // A technician who already holds a seat invitation here is not invited twice.
    const invitations = await sponsor.table('user_invitations').whereRaw('lower(trim(email)) = ?', [email])
      .select('invitation_id', 'token', 'used_at');
    const held = invitations.length ? await liveAssignments(trx, input.sponsorTenant)
      .whereIn('invitation_id', invitations.map((invitation) => invitation.invitation_id))
      .where('state', 'invited').first('assignment_id', 'arrangement_id', 'invitation_id') : undefined;
    if (held) {
      if (held.arrangement_id !== input.arrangementId) throw new CoManagedSeatInvitationError('EMAIL_INVITED');
      return {
        assignment_id: held.assignment_id, arrangement_id: held.arrangement_id, invitation_id: held.invitation_id, email,
        state: 'invited' as const, created: false,
        token: invitations.find((invitation) => invitation.invitation_id === held.invitation_id)?.token ?? '',
      };
    }

    // A technician becomes an internal user of the sponsor, and internal users sign in by email
    // with no tenant: the email must not already identify, or be promised to, an account anywhere.
    const claim = await User.findInternalEmailClaim(email, { db: trx });
    if (claim?.kind === 'user') throw new CoManagedSeatInvitationError('EMAIL_IN_USE');
    const pending = await sponsor.unscoped('user_invitations', EMAIL_CLAIM_REASON)
      .whereRaw('lower(trim(email)) = ?', [email]).whereNull('used_at')
      .where('expires_at', '>', trx.fn.now()).first('invitation_id');
    if (claim || pending) throw new CoManagedSeatInvitationError('EMAIL_INVITED');

    const allocation = await sponsor.table('co_managed_allocations')
      .where({ allocation_id: arrangement.allocation_id, allocation_kind: 'seat' }).first('seats');
    const committed = await count(liveAssignments(trx, input.sponsorTenant).where('arrangement_id', input.arrangementId));
    if (committed >= Number(allocation?.seats ?? 0)) throw new CoManagedSeatInvitationError('SEAT_LIMIT');

    const assignmentId = randomUUID();
    // No role: the seat role is given at acceptance. Until then the team setup path refuses this
    // invitation, so the token alone opens nothing.
    // (5) The foreign key to `tenants` takes KEY SHARE on the sponsor's tenant row here.
    // write-admission: exempt — seat invitation, written by its owning command under the pool and arrangement locks
    const [invitation] = await sponsor.table('user_invitations').insert({
      tenant: input.sponsorTenant,
      email,
      first_name: firstName,
      last_name: lastName,
      role_id: null,
      token: randomBytes(32).toString('hex'),
      expires_at: trx.raw("now() + interval '24 hours'"),
      metadata: {
        co_managed_seat_assignment_id: assignmentId,
        co_managed_seat_arrangement_id: input.arrangementId,
        ...(input.invitedBy ? { created_by: input.invitedBy } : {}),
      },
    }).returning(['invitation_id', 'token']);
    // write-admission: exempt — seat assignment lifecycle state, written by its owning command under the pool and arrangement locks
    await sponsor.table('co_managed_seat_assignments').insert({
      tenant: input.sponsorTenant,
      assignment_id: assignmentId,
      arrangement_id: input.arrangementId,
      invitation_id: invitation.invitation_id,
      state: 'invited',
    });
    return {
      assignment_id: assignmentId, arrangement_id: input.arrangementId, invitation_id: invitation.invitation_id, email,
      state: 'invited' as const, token: invitation.token, created: true,
    };
  });
}
