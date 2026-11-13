import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import {
  isCommentAudience, isCommentAudienceVisible, resolveCommentAudienceForRead,
  type CommentAudience, type CommentAudienceReader,
} from './commentAudience';

/**
 * The recipient boundary of ticket notifications.
 *
 * Everything a ticket sends to a person (email, in-app, watcher mail) and everything a person
 * sends back by email passes one question through here: WHO is this address or user on THIS
 * ticket, as an organization? The answer is a `CommentAudienceReader` (see `commentAudience.ts`),
 * so what a recipient may be told is decided by `isCommentAudienceVisible` and nothing else.
 *
 * Only a seat technician is ever narrowed. They are an internal user of the MSP's tenant whose
 * organization is one client, so every "is this an internal user?" test upstream would hand them
 * MSP-private content. For them:
 *
 *   - the reader is `seat` only while the ticket is IN SCOPE: their assignment and arrangement are
 *     live, the ticket belongs to their client and its board is in the arrangement's board scope;
 *   - anything else (assignment not live, other client, board out of scope, ticket unreadable)
 *     is `null`, which every predicate treats as "sees nothing".
 *
 * Scope is evaluated at delivery time, from rows. A subscription made while a ticket was in scope
 * therefore stops delivering the moment the ticket leaves it; nothing has to be cleaned up.
 *
 * Every other recipient resolves `{ seat: false }` and keeps exactly the behaviour they had.
 * The cost for them is one indexed read on `co_managed_seat_assignments` per batch, which is
 * empty for a tenant without seat technicians.
 */
export type TicketNotificationRecipient =
  | { seat: false }
  | { seat: true; userId: string; reader: CommentAudienceReader | null };

const NOT_SEAT: TicketNotificationRecipient = { seat: false };

/** The ticket a notification is about: its id, or its organization when the caller already has the row. */
export type NotificationTicket =
  | { ticketId: string | null | undefined }
  | { clientId: string | null | undefined; boardId: string | null | undefined };

/** How a caller names a recipient: a user, an address, or both. */
export interface NotificationRecipientKey {
  userId?: string | null;
  email?: string | null;
}

const normalizeEmail = (email: string | null | undefined): string | null => {
  const value = typeof email === 'string' ? email.trim().toLowerCase() : '';
  return value || null;
};

interface SeatRow {
  user_id: string;
  email: string | null;
  assignment_state: string | null;
  arrangement_id: string | null;
  arrangement_state: string | null;
  client_id: string | null;
}

/**
 * Resolves many recipients of one ticket at once. The result is index-aligned with `recipients`.
 *
 * A recipient matches a seat technician by user id or, because watchers are stored as bare
 * addresses, by the email of an internal user. One read finds the seat technicians among them;
 * only when there is at least one are the ticket's organization and the board scope read.
 */
export async function resolveTicketNotificationRecipients(
  trx: Knex | Knex.Transaction,
  tenant: string,
  ticket: NotificationTicket,
  recipients: readonly NotificationRecipientKey[],
): Promise<TicketNotificationRecipient[]> {
  const userIds = [...new Set(recipients.map(r => r.userId).filter((id): id is string => !!id))];
  const emails = [...new Set(recipients.map(r => normalizeEmail(r.email)).filter((e): e is string => !!e))];
  if (!tenant || (userIds.length === 0 && emails.length === 0)) return recipients.map(() => NOT_SEAT);

  const db = tenantDb(trx, tenant);
  const query = db.table('co_managed_seat_assignments as sa').whereNot('sa.state', 'revoked');
  db.tenantJoin(query, 'users as u', 'sa.user_id', 'u.user_id');
  db.tenantJoin(query, 'co_managed_seat_arrangements as ar', 'sa.arrangement_id', 'ar.arrangement_id', { type: 'left' });
  query.where('u.user_type', 'internal').andWhere(function (this: Knex.QueryBuilder) {
    if (userIds.length) this.orWhereIn('u.user_id', userIds);
    if (emails.length) this.orWhereIn(trx.raw('lower(u.email)') as unknown as string, emails);
  });
  const seats = (await query.select({
    user_id: 'u.user_id', email: 'u.email', assignment_state: 'sa.state',
    arrangement_id: 'ar.arrangement_id', arrangement_state: 'ar.state', client_id: 'ar.client_id',
  })) as unknown as SeatRow[];
  if (seats.length === 0) return recipients.map(() => NOT_SEAT);

  const organization = await readTicketOrganization(db, ticket);
  const liveArrangements = [...new Set(seats
    .filter(seat => seat.assignment_state === 'active' && seat.arrangement_state === 'active'
      && !!seat.arrangement_id && !!seat.client_id && seat.client_id === organization?.clientId)
    .map(seat => seat.arrangement_id as string))];
  const inScope = new Set<string>();
  if (organization?.boardId && liveArrangements.length) {
    const scoped = await db.table('co_managed_seat_board_scopes')
      .whereIn('arrangement_id', liveArrangements).where('board_id', organization.boardId).select('arrangement_id');
    for (const row of scoped as Array<{ arrangement_id: string }>) inScope.add(row.arrangement_id);
  }

  const byUser = new Map<string, SeatRow>();
  const byEmail = new Map<string, SeatRow>();
  for (const seat of seats) {
    byUser.set(seat.user_id, seat);
    const email = normalizeEmail(seat.email);
    if (email) byEmail.set(email, seat);
  }
  return recipients.map((recipient) => {
    const email = normalizeEmail(recipient.email);
    const seat = (recipient.userId ? byUser.get(recipient.userId) : undefined) ?? (email ? byEmail.get(email) : undefined);
    if (!seat) return NOT_SEAT;
    const reader: CommentAudienceReader | null = seat.arrangement_id && inScope.has(seat.arrangement_id) && seat.client_id
      ? { kind: 'seat', tenant, clientId: seat.client_id } : null;
    return { seat: true, userId: seat.user_id, reader };
  });
}

/** One recipient of one ticket. See `resolveTicketNotificationRecipients`. */
export async function resolveTicketNotificationRecipient(
  trx: Knex | Knex.Transaction,
  tenant: string,
  ticket: NotificationTicket,
  recipient: NotificationRecipientKey,
): Promise<TicketNotificationRecipient> {
  return (await resolveTicketNotificationRecipients(trx, tenant, ticket, [recipient]))[0];
}

async function readTicketOrganization(
  db: ReturnType<typeof tenantDb>,
  ticket: NotificationTicket,
): Promise<{ clientId: string | null; boardId: string | null } | null> {
  if ('ticketId' in ticket) {
    if (!ticket.ticketId) return null;
    const row = await db.table('tickets').where('ticket_id', ticket.ticketId).first('client_id', 'board_id');
    return row ? { clientId: row.client_id ?? null, boardId: row.board_id ?? null } : null;
  }
  return { clientId: ticket.clientId ?? null, boardId: ticket.boardId ?? null };
}

/**
 * May this recipient be told something of `audience` about the ticket they were resolved for?
 *
 * Not a seat technician: always, the caller's existing rules stand. A seat technician: only in
 * scope, and only what `isCommentAudienceVisible` shows their organization. A message that does
 * not say what it carries (`audience` missing) is never sent to them.
 *
 * Ticket-level facts (title, status, assignment) are `requester`: everyone admitted to the ticket.
 */
export function recipientMayReceive(
  recipient: TicketNotificationRecipient,
  audience: CommentAudience | null | undefined,
): boolean {
  if (!recipient.seat) return true;
  const reader = recipient.reader;
  if (!reader || reader.kind !== 'seat' || !isCommentAudience(audience)) return false;
  return isCommentAudienceVisible(audience, { tenant: reader.tenant, clientId: reader.clientId }, reader);
}

/** Is the ticket in this recipient's scope at all? True for everyone who is not a seat technician. */
export function recipientInScope(recipient: TicketNotificationRecipient): boolean {
  return recipientMayReceive(recipient, 'requester');
}

/** An audience known now, or read only if a seat technician turns out to be among the recipients. */
export type AudienceSource = CommentAudience | (() => Promise<CommentAudience>);

/** Reads an audience at most once, and not at all when no recipient needs it. */
export function lazyAudience(read: () => Promise<CommentAudience>): () => Promise<CommentAudience> {
  let pending: Promise<CommentAudience> | undefined;
  return () => (pending ??= read());
}

/** One rendering of a message, labelled with the narrowest audience of anything it quotes. */
export interface AudienceContent<T> {
  audience: AudienceSource;
  /** The rendering for this audience. Omitted: the message's own content already is it. */
  content?: T;
}

/** Ticket-level facts only (title, status, assignment, field changes): everyone admitted to the ticket. */
export const TICKET_FACTS_AUDIENCE: ReadonlyArray<AudienceContent<never>> = [{ audience: 'requester' }];

/**
 * Picks what a recipient gets from a message's renderings, listed richest first.
 *
 * Not a seat technician: `{ admitted: true }` with no selection and no audience read, so the
 * caller sends what it built. A seat technician gets the first rendering their audience admits,
 * or is not admitted. A message that declares no rendering is never sent to them.
 */
export async function selectAudienceContent<T>(
  recipient: TicketNotificationRecipient,
  renderings: ReadonlyArray<AudienceContent<T>> | null | undefined,
): Promise<{ admitted: false } | { admitted: true; selected?: { audience: CommentAudience; content?: T } }> {
  if (!recipient.seat) return { admitted: true };
  if (!recipientInScope(recipient)) return { admitted: false };
  for (const rendering of renderings ?? []) {
    const audience = typeof rendering.audience === 'function' ? await rendering.audience() : rendering.audience;
    if (recipientMayReceive(recipient, audience)) return { admitted: true, selected: { audience, content: rendering.content } };
  }
  return { admitted: false };
}

/**
 * The audience of one stored ticket comment, resolved from its thread, the thread's root and the
 * comment itself (`resolveCommentAudienceForRead`). A comment that cannot be read is private.
 */
export async function readTicketCommentAudience(
  trx: Knex | Knex.Transaction,
  tenant: string,
  commentId: string | null | undefined,
): Promise<CommentAudience> {
  if (!tenant || !commentId) return 'organization_private';
  const db = tenantDb(trx, tenant);
  const query = db.table('comments as c').where('c.comment_id', commentId);
  db.tenantJoin(query, 'comment_threads as t', 'c.thread_id', 't.thread_id', { type: 'left' });
  db.tenantJoin(query, 'comments as root', 't.root_comment_id', 'root.comment_id', { type: 'left' });
  const row = await query.first({
    thread_id: 't.thread_id', collaboration_audience: 't.collaboration_audience', is_internal: 't.is_internal',
    root_comment_id: 'root.comment_id', root_is_internal: 'root.is_internal', comment_is_internal: 'c.is_internal',
  });
  // No thread row means the audience cannot be established, which is private.
  if (!row?.thread_id) return 'organization_private';
  return resolveCommentAudienceForRead({
    collaboration_audience: row.collaboration_audience,
    is_internal: row.is_internal,
    root_is_internal: row.root_comment_id ? row.root_is_internal : undefined,
    comment_is_internal: row.comment_is_internal,
  });
}

/** Key under which a notification's reply token remembers the audience it was sent with. */
export const NOTIFICATION_AUDIENCE_TOKEN_KEY = 'notificationAudience';

/** The audience a reply token was minted with, when it recorded one. */
export function readNotificationAudience(tokenMetadata: unknown): CommentAudience | null {
  let metadata: unknown = tokenMetadata;
  if (typeof metadata === 'string') {
    try { metadata = JSON.parse(metadata); } catch { return null; }
  }
  if (!metadata || typeof metadata !== 'object') return null;
  const audience = (metadata as Record<string, unknown>)[NOTIFICATION_AUDIENCE_TOKEN_KEY];
  return isCommentAudience(audience) ? audience : null;
}
