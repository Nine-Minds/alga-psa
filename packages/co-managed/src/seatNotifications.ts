import type { Knex } from 'knex';
import { forcedValue } from '@alga-psa/core/capability';
import { resolveFlagTargeting } from '@alga-psa/core/features';
import { liveSeatArrangement, tenantDb } from '@alga-psa/db';
import { commentAudienceSql } from '@alga-psa/shared/lib/commentAudience';
import { resolveBoardNotificationAudience } from '@alga-psa/shared/lib/tickets/boardNotificationRules';
import { getAllTicketAssignees } from '@alga-psa/shared/lib/tickets/ticketAssignees';
import { coManagedSeatBoardAccess, readCoManagedSeatBoardScope } from './seatArrangement';
import type { CoManagedSeatHandoffReceipt, CoManagedSeatResponsibility } from './seatTicketHandoff';

/**
 * Who is told about seat-shape ticket work: a handoff in either direction, and a shared IT note.
 *
 * A ticket of a client in a seat arrangement has two organizations inside one tenant: MSP staff
 * and the client's seat technicians ("client IT"). This module answers one question for both
 * events: which users of the OTHER organization hear about it.
 *
 *   hand to client IT   the technician the handoff names, else every active technician of the client
 *   hand to MSP         the ticket's MSP assignee, else its team (the ticket's, else the board's
 *                       default); plus the board's on-create notification rule recipients: a ticket
 *                       coming back lands on the board the way a new ticket does
 *   shared IT note      the other organization's participants on the ticket
 *
 * Recipients are derived from stored state (the handoff receipt, the arrangement, its seats, the
 * ticket), never from a request, so resolving the same handoff or comment again gives the same
 * answer. Nothing is resolved for a tenant the gate does not serve or a client with no live
 * arrangement. Delivery is the caller's: this module creates no notification.
 */

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Conn = Knex | Knex.Transaction;
type Sponsor = ReturnType<typeof tenantDb>;

/**
 * The gate: are seat notifications served for this tenant? The one place the slice asks.
 *
 * Off under the `FORCE_CAPABILITIES=co-managed-seat:off` kill switch (or a malformed value) and
 * for a tenant that `release-v2-0-feature` tenant targeting closes; on under `co-managed-seat:on`.
 * Otherwise requires an explicit tenant rollout opt-in, in addition to the client's live seat
 * arrangement checked by every resolver. Unset targeting stays off: an arrangement alone is not
 * rollout consent. Never evaluates PostHog: subscribers and workers call this.
 *
 * Until the `co-managed-seat` capability is registered (plan slice S6) this reads the same force
 * key and rollout flag that capability will own; once it is, the body becomes
 * `isCapabilityServed('co-managed-seat', tenant)`.
 */
export function coManagedSeatNotificationsServed(tenant: string): boolean {
  if (!uuid.test(tenant ?? '')) return false;
  const forced = forcedValue(typeof process !== 'undefined' ? process.env.FORCE_CAPABILITIES : undefined, 'co-managed-seat');
  if (forced === 'on') return true;
  if (forced !== null) return false;
  return resolveFlagTargeting('release-v2-0-feature', tenant) === true;
}

// ---------------------------------------------------------------------------
// Organizations
// ---------------------------------------------------------------------------

/** Which side of a seat arrangement a user is on. A user on neither is told nothing. */
type SeatOrganization = 'msp' | 'client_it';

/**
 * Sorts users into the two organizations of one arrangement, dropping everyone else.
 *
 *   client_it  an active internal user whose seat in THIS arrangement is active
 *   msp        an active internal user holding no live seat anywhere
 *
 * An invited seat, a seat in another client's arrangement, an inactive user and a client (portal)
 * user belong to neither. Two reads for any number of users.
 */
async function seatOrganizations(sponsor: Sponsor, arrangementId: string, userIds: Iterable<string | null | undefined>): Promise<Map<string, SeatOrganization>> {
  const ids = [...new Set([...userIds].filter((id): id is string => typeof id === 'string' && uuid.test(id)))];
  const organizations = new Map<string, SeatOrganization>();
  if (ids.length === 0) return organizations;
  const [users, seats] = await Promise.all([
    sponsor.table('users').whereIn('user_id', ids).where({ user_type: 'internal', is_inactive: false }).select('user_id'),
    sponsor.table('co_managed_seat_assignments').whereIn('user_id', ids).whereNot('state', 'revoked').select('user_id', 'arrangement_id', 'state'),
  ]);
  const seatByUser = new Map<string, { arrangement_id: string; state: string }>(seats.map((seat: { user_id: string; arrangement_id: string; state: string }) => [seat.user_id, seat]));
  for (const { user_id: userId } of users as Array<{ user_id: string }>) {
    const seat = seatByUser.get(userId);
    if (!seat) organizations.set(userId, 'msp');
    else if (seat.arrangement_id === arrangementId && seat.state === 'active') organizations.set(userId, 'client_it');
  }
  return organizations;
}

/** Every active technician of an arrangement: the seat is active and the user can sign in. */
async function activeTechnicians(sponsor: Sponsor, arrangementId: string): Promise<string[]> {
  const seated: string[] = await sponsor.table('co_managed_seat_assignments')
    .where({ arrangement_id: arrangementId, state: 'active' }).whereNotNull('user_id').pluck('user_id');
  const organizations = await seatOrganizations(sponsor, arrangementId, seated);
  return seated.filter((userId) => organizations.get(userId) === 'client_it');
}

/** Whether the arrangement still shares the ticket's board with its technicians. */
async function boardShared(db: Conn, tenant: string, arrangementId: string, boardId: string | null): Promise<boolean> {
  if (!boardId) return false;
  const scope = await readCoManagedSeatBoardScope(db, { sponsorTenant: tenant, arrangementId });
  return coManagedSeatBoardAccess(scope, boardId) !== 'none';
}

const only = (organizations: Map<string, SeatOrganization>, organization: SeatOrganization, userIds: Iterable<string | null | undefined>, except: string | null): string[] =>
  [...new Set([...userIds].filter((id): id is string => !!id && id !== except && organizations.get(id) === organization))].sort();

// ---------------------------------------------------------------------------
// Handoff
// ---------------------------------------------------------------------------

export interface CoManagedSeatHandoffNotice {
  tenant: string;
  operationId: string;
  ticketId: string;
  arrangementId: string;
  /** Who the ticket was handed to: the organization being told. */
  to: CoManagedSeatResponsibility;
  actorUserId: string;
  /** The handoff's shared IT note, readable by both organizations. */
  note: string;
  /** Users to tell, sorted, never including the actor. Empty when there is no one. */
  recipients: string[];
  /**
   * The recipients told ONLY by a board notification rule. They were never put on the ticket, so
   * delivery applies the rule's own check that each can open it. Always a subset of `recipients`.
   */
  boardRuleRecipients: string[];
}

/**
 * Who a recorded handoff notifies, read from its receipt. Null when the tenant is not served, no
 * such handoff exists, or the ticket's client no longer has the arrangement the handoff was made
 * under (an ended arrangement tells no one).
 *
 * To client IT: the technician the handoff left the ticket assigned to, when that is an active
 * technician of this client; otherwise every active technician of the client. To the MSP: the
 * assignee the handoff left, else the active members of the ticket's team (else the board's
 * default team), plus the board's on-create notification rule recipients. Every recipient is of
 * the receiving organization and none is the actor.
 */
export async function resolveCoManagedSeatHandoffNotice(
  db: Conn,
  input: { sponsorTenant: string; operationId: string },
): Promise<CoManagedSeatHandoffNotice | null> {
  if (![input.sponsorTenant, input.operationId].every((id) => typeof id === 'string' && uuid.test(id))) return null;
  const tenant = input.sponsorTenant.toLowerCase();
  if (!coManagedSeatNotificationsServed(tenant)) return null;
  const sponsor = tenantDb(db, tenant);
  const handoff = await sponsor.table('co_managed_seat_ticket_handoffs').where('operation_id', input.operationId.toLowerCase())
    .first('operation_id', 'ticket_id', 'arrangement_id', 'to_responsibility', 'actor_user_id', 'assigned_to', 'note');
  if (!handoff) return null;
  const ticket = await sponsor.table('tickets').where('ticket_id', handoff.ticket_id).first('client_id', 'board_id', 'assigned_team_id');
  const arrangement = ticket && await liveSeatArrangement(sponsor, ticket.client_id);
  if (!arrangement || arrangement.arrangement_id !== handoff.arrangement_id) return null;

  const to: CoManagedSeatResponsibility = handoff.to_responsibility;
  const notice = (recipients: string[], boardRuleRecipients: string[] = []): CoManagedSeatHandoffNotice => ({
    tenant, operationId: handoff.operation_id, ticketId: handoff.ticket_id, arrangementId: handoff.arrangement_id,
    to, actorUserId: handoff.actor_user_id, note: handoff.note, recipients, boardRuleRecipients,
  });

  if (to === 'client_it') {
    // A board that has since left the arrangement's scope is one no technician can open.
    if (!await boardShared(db, tenant, handoff.arrangement_id, ticket.board_id)) return notice([]);
    const technicians = await activeTechnicians(sponsor, handoff.arrangement_id);
    const named = handoff.assigned_to && technicians.includes(handoff.assigned_to) ? [handoff.assigned_to] : technicians;
    return notice(named.filter((userId) => userId !== handoff.actor_user_id).sort());
  }

  // The assignment rule: the assignee, else the team that picks up unassigned work.
  let assigned: string[] = handoff.assigned_to ? [handoff.assigned_to] : [];
  if (assigned.length === 0) {
    const board = ticket.board_id
      ? await sponsor.table('boards').where('board_id', ticket.board_id).first('default_assigned_team_id') : undefined;
    const teamId = ticket.assigned_team_id || board?.default_assigned_team_id;
    if (teamId) assigned = await sponsor.table('team_members').where('team_id', teamId).pluck('user_id');
  }
  // The board rule: a ticket handed back arrives on its board as a new ticket does.
  const boardRule = ticket.board_id
    ? (await resolveBoardNotificationAudience(db, tenant, { kind: 'created', boardId: ticket.board_id })).users.map((user) => user.userId)
    : [];
  const candidates = [...assigned, ...boardRule];
  const recipients = only(await seatOrganizations(sponsor, handoff.arrangement_id, candidates), 'msp', candidates, handoff.actor_user_id);
  return notice(recipients, recipients.filter((userId) => !assigned.includes(userId)));
}

// ---------------------------------------------------------------------------
// Handoff listeners
// ---------------------------------------------------------------------------

/** Told once per recorded handoff, after it commits. A replay of the operation tells no one. */
export type CoManagedSeatHandoffListener = (receipt: CoManagedSeatHandoffReceipt & { sponsorTenant: string }) => void | Promise<void>;

const LISTENERS_KEY = Symbol.for('alga.coManaged.seatHandoffListeners');
type ListenerHost = typeof globalThis & { [LISTENERS_KEY]?: Map<string, CoManagedSeatHandoffListener> };

// On globalThis: Next bundles this module more than once, and the command and the registration
// must meet in one registry.
function listeners(): Map<string, CoManagedSeatHandoffListener> {
  const host = globalThis as ListenerHost;
  return (host[LISTENERS_KEY] ??= new Map());
}

/**
 * Registers what happens after a handoff commits (the server registers notification delivery).
 * Keyed by name, so registering again replaces. Returns the function that removes it.
 */
export function registerCoManagedSeatHandoffListener(name: string, listener: CoManagedSeatHandoffListener): () => void {
  listeners().set(name, listener);
  return () => { if (listeners().get(name) === listener) listeners().delete(name); };
}

/**
 * Called by the handoff command after its transaction commits, for a newly recorded handoff only.
 * The handoff has happened: a listener that throws is logged and never fails the command.
 */
export async function announceCoManagedSeatHandoff(sponsorTenant: string, receipt: CoManagedSeatHandoffReceipt): Promise<void> {
  for (const [name, listener] of [...listeners()]) {
    try {
      await listener({ ...receipt, sponsorTenant });
    } catch (error) {
      console.error('[co-managed seat handoff] listener failed; isolated', {
        listener: name, tenant: sponsorTenant, operationId: receipt.operationId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Shared IT note
// ---------------------------------------------------------------------------

/**
 * Who a published shared IT note notifies: the participants on the ticket who belong to the
 * organization the author does not. Empty unless the tenant is served, the ticket's client has a
 * live seat arrangement, the stored comment resolves `shared_it`, and the author is MSP staff or
 * an active technician of that client.
 *
 * A participant is someone already taking part in the ticket: its assignee and additional agents,
 * anyone who has written a comment on it, and anyone who has handed it off under this
 * arrangement. Technicians are told only while the arrangement still shares the ticket's board.
 * The audience is read from the stored thread, never from the event that announced the comment.
 */
export async function resolveCoManagedSeatSharedNoteRecipients(
  db: Conn,
  input: { tenant: string; ticketId: string; commentId: string; authorUserId: string | null | undefined },
): Promise<string[]> {
  const { authorUserId } = input;
  if (![input.tenant, input.ticketId, input.commentId, authorUserId].every((id) => typeof id === 'string' && uuid.test(id))) return [];
  const tenant = input.tenant.toLowerCase();
  if (!coManagedSeatNotificationsServed(tenant)) return [];
  const sponsor = tenantDb(db, tenant);
  const ticket = await sponsor.table('tickets').where('ticket_id', input.ticketId).first('client_id', 'board_id');
  const arrangement = ticket && await liveSeatArrangement(sponsor, ticket.client_id);
  if (!arrangement) return [];

  const commentQuery = sponsor.table('comments as c').where({ 'c.comment_id': input.commentId, 'c.ticket_id': input.ticketId });
  sponsor.tenantJoin(commentQuery, 'comment_threads as th', 'c.thread_id', 'th.thread_id');
  sponsor.tenantJoin(commentQuery, 'comments as root', 'th.root_comment_id', 'root.comment_id');
  const comment = await commentQuery.first({ audience: commentAudienceSql(db, 'th', 'root', 'c'), publish_state: 'c.publish_state' });
  if (comment?.audience !== 'shared_it' || comment.publish_state !== 'published') return [];

  const [assignees, authors, handoffActors] = await Promise.all([
    getAllTicketAssignees(db, tenant, input.ticketId),
    sponsor.table('comments').where('ticket_id', input.ticketId).whereNotNull('user_id').distinct('user_id').pluck('user_id'),
    sponsor.table('co_managed_seat_ticket_handoffs').where({ ticket_id: input.ticketId, arrangement_id: arrangement.arrangement_id })
      .distinct('actor_user_id').pluck('actor_user_id'),
  ]);
  const participants: string[] = [...assignees, ...authors, ...handoffActors];
  const organizations = await seatOrganizations(sponsor, arrangement.arrangement_id, [...participants, authorUserId]);
  const author = organizations.get(authorUserId as string);
  if (!author) return [];
  const other: SeatOrganization = author === 'msp' ? 'client_it' : 'msp';
  if (other === 'client_it' && !await boardShared(db, tenant, arrangement.arrangement_id, ticket.board_id)) return [];
  return only(organizations, other, participants, authorUserId as string);
}
