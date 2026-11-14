import { randomBytes, randomUUID } from 'node:crypto';
import type { Knex } from 'knex';
import { hashPassword } from '@alga-psa/core/encryption';
import { tenantDb } from '@alga-psa/db';
import User from '@alga-psa/db/models/user';
import { readCoManagedSeatAllocationState, type CountCoManagedSeatCommitments } from '@alga-psa/licensing';
import { retainBuiltinResolverSubject } from '@alga-psa/authorization/subject/resolverSubjects';
import { CO_MANAGED_SEAT_RESOLVER_ID } from './seatAuthority';
import { admitCoManagedSeatRole } from './seatRole';

/**
 * Seat invitations: a technician of one of the sponsor's clients, invited as one of that client's
 * contacts into that client's seat arrangement and admitted against the arrangement's allocation, never against
 * the sponsor's own licensed seats. Accepting the invitation makes the technician an internal user
 * of the sponsor who holds the seat role and nothing else.
 *
 * Internal commands with no entry point of their own; a caller must authorize sponsor
 * administration and access to the client before using them.
 */

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const emailShape = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const EMAIL_CLAIM_REASON = 'internal user emails are unique across tenants, including pending invitations';
const TOKEN_DISCOVERY_TENANT = '__co_managed_seat_invitation__';
const TOKEN_DISCOVERY_REASON = 'seat invitation acceptance: the token is the only thing the technician holds, and it names the sponsor';

type InvitationCode = 'INVALID_INVITATION' | 'ARRANGEMENT_NOT_FOUND' | 'ARRANGEMENT_ENDED' | 'ENTITLEMENT_LAPSED' |
  'EMAIL_IN_USE' | 'EMAIL_INVITED' | 'SEAT_LIMIT' | 'CONTACT_NOT_FOUND' | 'CONTACT_WRONG_CLIENT' |
  'CONTACT_INACTIVE' | 'CONTACT_NO_EMAIL' | 'CONTACT_HAS_SEAT' | 'INVALID_ACCEPTANCE' | 'INVITATION_NOT_FOUND' |
  'INVITATION_EXPIRED' | 'INVITATION_REVOKED' | 'ASSIGNMENT_NOT_PENDING';

export class CoManagedSeatInvitationError extends Error {
  constructor(public readonly code: InvitationCode) {
    super(({
      INVALID_INVITATION: 'Choose a contact to invite.',
      CONTACT_NOT_FOUND: 'This contact was not found.',
      CONTACT_WRONG_CLIENT: 'This contact does not belong to the arrangement\'s client.',
      CONTACT_INACTIVE: 'This contact is inactive. Reactivate the contact before inviting them.',
      CONTACT_NO_EMAIL: 'This contact has no email address. Add one to the contact before inviting them.',
      CONTACT_HAS_SEAT: 'This contact already holds a seat or a pending invitation.',
      ARRANGEMENT_NOT_FOUND: 'Seat arrangement not found.',
      ARRANGEMENT_ENDED: 'This seat arrangement has ended.',
      ENTITLEMENT_LAPSED: 'Restore the co-managed pool before inviting a technician.',
      EMAIL_IN_USE: 'This email address already belongs to a user account. Use a different address.',
      EMAIL_INVITED: 'This email address already has a pending invitation.',
      SEAT_LIMIT: 'Every seat in this arrangement is in use. Add seats before inviting another technician.',
      INVALID_ACCEPTANCE: 'Provide the invitation link and a password.',
      INVITATION_NOT_FOUND: 'This invitation is not valid.',
      INVITATION_EXPIRED: 'This invitation has expired. Ask for a new one.',
      INVITATION_REVOKED: 'This invitation was withdrawn.',
      ASSIGNMENT_NOT_PENDING: 'Only a pending invitation can be changed here.',
    } satisfies Record<InvitationCode, string>)[code]);
    this.name = 'CoManagedSeatInvitationError';
  }
}

export interface InviteCoManagedSeatTechnicianInput {
  sponsorTenant: string;
  arrangementId: string;
  /** The client contact to invite. Name and email are read from the contact, never supplied. */
  contactId: string;
  /** The sponsor user who sent the invitation, when there is one. */
  invitedBy?: string;
}

export interface CoManagedSeatInvitation {
  assignment_id: string;
  arrangement_id: string;
  invitation_id: string;
  contact_id: string;
  email: string;
  /** The contact's name, split for the invitation. */
  firstName: string;
  lastName: string;
  state: 'invited';
  /** The setup token. The caller delivers it after this command commits, never inside it. */
  token: string;
  /** False when the technician already held this invitation; no further seat was taken. */
  created: boolean;
}

/** Splits a contact's full name into the first and last name an invitation stores. */
export function splitContactName(fullName: string): { firstName: string; lastName: string } {
  const [firstName = '', ...rest] = fullName.trim().split(/\s+/);
  return { firstName, lastName: rest.join(' ') };
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
 * The technician is a contact of the arrangement's client. The name and email are read from the
 * contact row inside the transaction and stored on the invitation; the caller supplies only the id.
 *
 * Declarative on the contact: inviting a contact who already holds a pending invitation to this
 * arrangement returns that invitation and takes no further seat.
 *
 * Refuses with `ARRANGEMENT_NOT_FOUND`, `ARRANGEMENT_ENDED`, `ENTITLEMENT_LAPSED` (lapse grace or
 * read-only, as every other seat admission), `CONTACT_NOT_FOUND` (no such contact in the sponsor
 * tenant), `CONTACT_WRONG_CLIENT` (it belongs to another client), `CONTACT_INACTIVE`,
 * `CONTACT_NO_EMAIL`, `CONTACT_HAS_SEAT` (it already holds a live seat or pending invitation, on
 * this or any other arrangement), `EMAIL_IN_USE` (an internal user anywhere on the
 * platform already signs in with it), `EMAIL_INVITED` (it is promised to a pending invitation or
 * workspace setup) and `SEAT_LIMIT` (committed seats would exceed the allocation).
 *
 * Locks, in this order and no other:
 *
 *   1. the sponsor's internal-user seat lock (advisory, per tenant),
 *   2. the sponsor's entitlement row,
 *   3. the seat allocation row,
 *   4. the arrangement row,
 *   5. the contact row (FOR SHARE, so it cannot be deactivated or moved to another client mid-invite),
 *   6. the sponsor's `tenants` row (KEY SHARE, taken by the invitation insert's foreign key).
 *
 * Why this cannot deadlock. A deadlock needs two transactions that each hold a lock the other is
 * waiting for, so it needs two of these locks taken in opposite orders somewhere. None are:
 *
 * - Reservation, arrangement creation, resize, release, purchase (its second transaction) and
 *   hosted reconcile all take the entitlement row first and never take the seat lock, so against
 *   them (1) is uncontended and everything after it is ordered behind (2). Whichever holds (2)
 *   runs to commit; it waits for nothing an invitation can hold, because an invitation holds
 *   (3) to (6) only after it holds (2).
 * - Purchase and reservation also lock the `tenants` row, after the entitlement row: the same
 *   order as (2) then (6). Purchase's first transaction locks `tenants` alone and waits for no
 *   other lock.
 * - Board scope locks the arrangement row alone. Contact edits lock the contact row alone and wait
 *   for none of the above.
 * - The internal-user paths (create, invite, reactivate) take the seat lock first and then row
 *   locks, never the reverse, and they do not take this tenant's entitlement row.
 *
 * The total order is therefore: seat lock, entitlement, allocation, arrangement, contact, tenant. Every
 * command takes a subsequence of it.
 */
export async function inviteCoManagedSeatTechnician(
  db: Knex,
  input: InviteCoManagedSeatTechnicianInput,
): Promise<CoManagedSeatInvitation> {
  if (![input.sponsorTenant, input.arrangementId, input.contactId, ...(input.invitedBy === undefined ? [] : [input.invitedBy])]
        .every((id) => typeof id === 'string' && uuid.test(id))) {
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
    const arrangement = await arrangements().forUpdate().first('state', 'allocation_id', 'client_id');
    if (!arrangement) throw new CoManagedSeatInvitationError('ARRANGEMENT_NOT_FOUND');
    if (arrangement.state !== 'active' || arrangement.allocation_id !== found.allocation_id || pool.state === 'terminated') {
      throw new CoManagedSeatInvitationError('ARRANGEMENT_ENDED');
    }
    if (pool.state !== 'active') throw new CoManagedSeatInvitationError('ENTITLEMENT_LAPSED');

    // A contact who already holds a live seat or pending invitation. On this arrangement a pending
    // invitation is returned as it is (the command is declarative); anywhere else it is refused.
    const holding = await liveAssignments(trx, input.sponsorTenant).where('contact_id', input.contactId)
      .first('assignment_id', 'arrangement_id', 'invitation_id', 'state');
    if (holding) {
      const replay = holding.state === 'invited' && holding.arrangement_id === input.arrangementId && holding.invitation_id
        ? await sponsor.table('user_invitations').where('invitation_id', holding.invitation_id)
          .first('token', 'email', 'first_name', 'last_name', 'used_at')
        : undefined;
      if (!replay || replay.used_at) throw new CoManagedSeatInvitationError('CONTACT_HAS_SEAT');
      return {
        assignment_id: holding.assignment_id, arrangement_id: holding.arrangement_id, invitation_id: holding.invitation_id,
        contact_id: input.contactId, email: String(replay.email), firstName: String(replay.first_name ?? ''),
        lastName: String(replay.last_name ?? ''), state: 'invited' as const, created: false, token: replay.token ?? '',
      };
    }

    // (5) The contact, read here and nowhere else: its name and email are what the invitation stores.
    const contact = await sponsor.table('contacts').where('contact_name_id', input.contactId).forShare()
      .first('client_id', 'full_name', 'email', 'is_inactive');
    if (!contact) throw new CoManagedSeatInvitationError('CONTACT_NOT_FOUND');
    if (contact.client_id !== arrangement.client_id) throw new CoManagedSeatInvitationError('CONTACT_WRONG_CLIENT');
    if (contact.is_inactive) throw new CoManagedSeatInvitationError('CONTACT_INACTIVE');
    const email = typeof contact.email === 'string' ? contact.email.trim().toLowerCase() : '';
    if (!emailShape.test(email)) throw new CoManagedSeatInvitationError('CONTACT_NO_EMAIL');
    const { firstName, lastName } = splitContactName(String(contact.full_name ?? ''));
    if (!firstName) throw new CoManagedSeatInvitationError('CONTACT_NOT_FOUND');

    // The email may still be promised to another invitation (a legacy seat invitation or workspace setup).
    const invitations = await sponsor.table('user_invitations').whereRaw('lower(trim(email)) = ?', [email])
      .select('invitation_id');
    const heldByEmail = invitations.length ? await liveAssignments(trx, input.sponsorTenant)
      .whereIn('invitation_id', invitations.map((invitation) => invitation.invitation_id))
      .where('state', 'invited').first('assignment_id') : undefined;
    if (heldByEmail) throw new CoManagedSeatInvitationError('EMAIL_INVITED');

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
    // (6) The foreign key to `tenants` takes KEY SHARE on the sponsor's tenant row here.
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
      contact_id: input.contactId,
      state: 'invited',
    });
    return {
      assignment_id: assignmentId, arrangement_id: input.arrangementId, invitation_id: invitation.invitation_id,
      contact_id: input.contactId, email, firstName, lastName,
      state: 'invited' as const, token: invitation.token, created: true,
    };
  });
}

export interface AcceptCoManagedSeatInvitationInput {
  /** The setup token the invitation was delivered with. */
  token: string;
  /** The technician's chosen password. The caller has already held it to the password policy. */
  password: string;
}

export interface CoManagedSeatAcceptance {
  sponsor_tenant: string;
  assignment_id: string;
  arrangement_id: string;
  user_id: string;
  email: string;
  state: 'active';
  /** False when this invitation had already been accepted; nothing was written. */
  created: boolean;
}

/**
 * Accepts a seat invitation: creates the technician as a `user_type = 'internal'` user of the
 * sponsor whose only role is the seat role, activates the assignment and spends the token, in
 * one transaction. All of it exists afterwards or none of it does.
 *
 * The seat was admitted against the arrangement's allocation when the invitation was sent, so
 * nothing is admitted against the sponsor's licensed seats here.
 *
 * Declarative on the token: accepting an invitation that has already been accepted returns the
 * technician it created and writes nothing, so a repeated or concurrent submission cannot make
 * a second user. The password of a repeat is ignored.
 *
 * Refuses with `INVITATION_NOT_FOUND` (no seat invitation carries the token), `INVITATION_EXPIRED`,
 * `INVITATION_REVOKED`, `ARRANGEMENT_ENDED`, `ENTITLEMENT_LAPSED` (lapse grace or read-only, as
 * every other seat admission) and `EMAIL_IN_USE` (an internal user took the address after the
 * invitation was sent).
 *
 * Locks: the order `inviteCoManagedSeatTechnician` documents (seat lock, entitlement, allocation,
 * arrangement), then the assignment row and the invitation row, which only a holder of the
 * arrangement lock takes.
 */
export async function acceptCoManagedSeatInvitation(
  db: Knex,
  input: AcceptCoManagedSeatInvitationInput,
): Promise<CoManagedSeatAcceptance> {
  if (typeof input.token !== 'string' || !/^[0-9a-f]{64}$/.test(input.token) ||
      typeof input.password !== 'string' || !input.password) {
    throw new CoManagedSeatInvitationError('INVALID_ACCEPTANCE');
  }

  // Unlocked: only to learn which sponsor and which assignment to lock. Re-read under lock below.
  const found = await tenantDb(db, TOKEN_DISCOVERY_TENANT).unscoped('user_invitations', TOKEN_DISCOVERY_REASON)
    .where('token', input.token).first('tenant', 'invitation_id', 'metadata');
  const assignmentId = found?.metadata?.co_managed_seat_assignment_id;
  if (!found || typeof assignmentId !== 'string' || !uuid.test(assignmentId)) {
    throw new CoManagedSeatInvitationError('INVITATION_NOT_FOUND');
  }
  const sponsorTenant: string = found.tenant;
  // Hashed before any lock is taken; it is deliberately slow.
  const hashedPassword = await hashPassword(input.password);

  return db.transaction(async (trx) => {
    const sponsor = tenantDb(trx, sponsorTenant);
    const assignments = () => sponsor.table('co_managed_seat_assignments')
      .where({ assignment_id: assignmentId, invitation_id: found.invitation_id });

    // (1) Acceptance adds an internal user to this tenant, so it joins the internal-user order.
    // LEVERAGE: pattern internal-user-seat-lock — third copy of lockInternalUserSeats (see inviteCoManagedSeatTechnician above).
    await trx.raw('SELECT pg_advisory_xact_lock(hashtext(?), hashtext(?))', ['internal_user_seats', sponsorTenant]);

    const located = await assignments().first('arrangement_id');
    if (!located) throw new CoManagedSeatInvitationError('INVITATION_NOT_FOUND');
    const arrangements = () => sponsor.table('co_managed_seat_arrangements').where('arrangement_id', located.arrangement_id);
    const unlocked = await arrangements().first('allocation_id');
    if (!unlocked) throw new CoManagedSeatInvitationError('INVITATION_NOT_FOUND');

    // (2) and (3): the pool, then the allocation. (4): the arrangement.
    const pool = await readCoManagedSeatAllocationState(trx, sponsorTenant, unlocked.allocation_id);
    const arrangement = await arrangements().forUpdate().first('state', 'allocation_id');
    const assignment = await assignments().forUpdate().first('assignment_id', 'arrangement_id', 'state', 'user_id');
    const invitation = await sponsor.table('user_invitations')
      .where({ invitation_id: found.invitation_id, token: input.token }).forUpdate()
      .first('email', 'first_name', 'last_name', 'used_at', trx.raw('expires_at <= now() AS expired'));
    if (!assignment || !invitation) throw new CoManagedSeatInvitationError('INVITATION_NOT_FOUND');

    // Already accepted: the answer the first acceptance gave, whatever has happened since.
    if (assignment.state === 'active' && invitation.used_at && assignment.user_id) {
      return {
        sponsor_tenant: sponsorTenant, assignment_id: assignment.assignment_id, arrangement_id: assignment.arrangement_id,
        user_id: assignment.user_id, email: invitation.email, state: 'active' as const, created: false,
      };
    }
    if (assignment.state === 'revoked') throw new CoManagedSeatInvitationError('INVITATION_REVOKED');
    if (assignment.state !== 'invited' || invitation.used_at) throw new CoManagedSeatInvitationError('INVITATION_NOT_FOUND');

    if (!arrangement || arrangement.state !== 'active' || arrangement.allocation_id !== unlocked.allocation_id ||
        pool.state === 'terminated') {
      throw new CoManagedSeatInvitationError('ARRANGEMENT_ENDED');
    }
    if (pool.state !== 'active') throw new CoManagedSeatInvitationError('ENTITLEMENT_LAPSED');
    if (invitation.expired) throw new CoManagedSeatInvitationError('INVITATION_EXPIRED');

    // The invitation promised the address, but only against other invitations: an internal user
    // created since, here or in another tenant, still wins it.
    const email = String(invitation.email).trim().toLowerCase();
    const claim = await User.findInternalEmailClaim(email, { db: trx });
    if (claim?.kind === 'user') throw new CoManagedSeatInvitationError('EMAIL_IN_USE');

    // The role the first arrangement seeded. Re-admitted here, under the same pool lock, so an
    // acceptance never creates a technician without it.
    const roleId = await admitCoManagedSeatRole(trx, sponsorTenant);

    const userId = randomUUID();
    await sponsor.table('users').insert({
      tenant: sponsorTenant,
      user_id: userId,
      username: email,
      email,
      first_name: invitation.first_name,
      last_name: invitation.last_name || null,
      hashed_password: hashedPassword,
      user_type: 'internal',
      is_inactive: false,
    });
    // The seat role and no other.
    await sponsor.table('user_roles').insert({ tenant: sponsorTenant, user_id: userId, role_id: roleId });
    // The assignment's foreign key requires the resolver membership first, in this transaction.
    await retainBuiltinResolverSubject(trx, { tenant: sponsorTenant, userId }, CO_MANAGED_SEAT_RESOLVER_ID);
    // write-admission: exempt — seat assignment lifecycle state, written by its owning command under the pool and arrangement locks
    await sponsor.table('co_managed_seat_assignments').where('assignment_id', assignment.assignment_id)
      .update({ state: 'active', user_id: userId, updated_at: new Date() });
    // write-admission: exempt — seat invitation, spent by its owning command under the pool and arrangement locks
    await sponsor.table('user_invitations').where('invitation_id', found.invitation_id)
      .update({ used_at: trx.fn.now() });

    return {
      sponsor_tenant: sponsorTenant, assignment_id: assignment.assignment_id, arrangement_id: assignment.arrangement_id,
      user_id: userId, email, state: 'active' as const, created: true,
    };
  });
}

export interface CoManagedSeatInvitationChange {
  sponsorTenant: string;
  /** The seat assignment the invitation holds, as listed on the arrangement. */
  assignmentId: string;
}

export interface CoManagedSeatInvitationRefresh {
  assignment_id: string;
  arrangement_id: string;
  email: string;
  firstName: string;
  lastName: string;
  /** The new setup token. The caller delivers it after this command commits, never inside it. */
  token: string;
}

/** Locks the pending invitation behind an assignment, in the arrangement, assignment, invitation order acceptance uses. */
async function lockPendingSeatInvitation(trx: Knex.Transaction, input: CoManagedSeatInvitationChange) {
  const sponsor = tenantDb(trx, input.sponsorTenant);
  const located = await sponsor.table('co_managed_seat_assignments').where('assignment_id', input.assignmentId)
    .first('arrangement_id');
  if (!located) throw new CoManagedSeatInvitationError('INVITATION_NOT_FOUND');
  const arrangement = await sponsor.table('co_managed_seat_arrangements')
    .where('arrangement_id', located.arrangement_id).forUpdate().first('state');
  const assignment = await sponsor.table('co_managed_seat_assignments').where('assignment_id', input.assignmentId)
    .forUpdate().first('assignment_id', 'arrangement_id', 'invitation_id', 'state');
  if (!arrangement || !assignment) throw new CoManagedSeatInvitationError('INVITATION_NOT_FOUND');
  const invitation = assignment.invitation_id ? await sponsor.table('user_invitations')
    .where('invitation_id', assignment.invitation_id).forUpdate().first('invitation_id', 'email', 'first_name', 'last_name', 'used_at') : undefined;
  return { sponsor, arrangement, assignment, invitation };
}

/**
 * Withdraws a pending seat invitation and gives its seat back to the arrangement: the assignment
 * becomes `revoked`, so it no longer counts as committed, and the invitation's token is spent.
 *
 * Pending invitations only. An accepted technician is a user, not an invitation; revoking one
 * deactivates the user and belongs to the revocation command, which refuses here with
 * `ASSIGNMENT_NOT_PENDING`. Declarative: revoking an invitation that is already revoked changes
 * nothing and reports `revoked: false`.
 *
 * Locks the arrangement, assignment and invitation rows, in the order acceptance takes them, and
 * never the pool.
 */
export async function revokeCoManagedSeatInvitation(
  db: Knex,
  input: CoManagedSeatInvitationChange,
): Promise<{ revoked: boolean }> {
  if (![input.sponsorTenant, input.assignmentId].every((id) => typeof id === 'string' && uuid.test(id))) {
    throw new CoManagedSeatInvitationError('INVITATION_NOT_FOUND');
  }
  return db.transaction(async (trx) => {
    const { sponsor, assignment, invitation } = await lockPendingSeatInvitation(trx, input);
    if (assignment.state === 'revoked') return { revoked: false };
    if (assignment.state !== 'invited') throw new CoManagedSeatInvitationError('ASSIGNMENT_NOT_PENDING');
    // write-admission: exempt — seat assignment lifecycle state, written by its owning command under the arrangement lock
    await sponsor.table('co_managed_seat_assignments').where('assignment_id', assignment.assignment_id)
      .update({ state: 'revoked', revoked_at: trx.fn.now(), updated_at: trx.fn.now() });
    if (invitation && !invitation.used_at) {
      // write-admission: exempt — seat invitation, spent by its owning command under the arrangement lock
      await sponsor.table('user_invitations').where('invitation_id', invitation.invitation_id).update({
        used_at: trx.fn.now(),
        metadata: trx.raw('metadata || ?::jsonb', [JSON.stringify({ revoked: true, revoked_at: new Date().toISOString() })]),
      });
    }
    return { revoked: true };
  });
}

/**
 * Sends a pending seat invitation again: a new setup token (the old link stops working) and a
 * new 24 hours. It takes no further seat, since the invitation already holds one. The caller
 * delivers the returned token after this command commits.
 *
 * Refuses with `ARRANGEMENT_ENDED` for an arrangement that has ended and with
 * `ASSIGNMENT_NOT_PENDING` for a technician who has accepted or an invitation that was revoked.
 */
export async function refreshCoManagedSeatInvitation(
  db: Knex,
  input: CoManagedSeatInvitationChange,
): Promise<CoManagedSeatInvitationRefresh> {
  if (![input.sponsorTenant, input.assignmentId].every((id) => typeof id === 'string' && uuid.test(id))) {
    throw new CoManagedSeatInvitationError('INVITATION_NOT_FOUND');
  }
  return db.transaction(async (trx) => {
    const { sponsor, arrangement, assignment, invitation } = await lockPendingSeatInvitation(trx, input);
    if (arrangement.state !== 'active') throw new CoManagedSeatInvitationError('ARRANGEMENT_ENDED');
    if (assignment.state !== 'invited' || !invitation || invitation.used_at) {
      throw new CoManagedSeatInvitationError('ASSIGNMENT_NOT_PENDING');
    }
    const token = randomBytes(32).toString('hex');
    // write-admission: exempt — seat invitation, refreshed by its owning command under the arrangement lock
    await sponsor.table('user_invitations').where('invitation_id', invitation.invitation_id)
      .update({ token, expires_at: trx.raw("now() + interval '24 hours'") });
    return {
      assignment_id: assignment.assignment_id, arrangement_id: assignment.arrangement_id, token,
      email: String(invitation.email), firstName: String(invitation.first_name ?? ''), lastName: String(invitation.last_name ?? ''),
    };
  });
}
