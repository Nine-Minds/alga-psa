import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { serves, type CapabilityReason } from '@alga-psa/core/capability';
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
 *     reads as an EXTERNAL party: a `requester` reader. They are never refused, on any ticket
 *     (a watcher, a Cc, a reply), but they are told only what a requester is told, in the client
 *     rendering and with the portal link (`recipientRendering`), and their replies are stored
 *     as `requester`.
 *
 * Scope is evaluated at delivery time, from live rows. A subscription made while a ticket was in
 * scope is therefore downgraded to the external requester rendering the moment the ticket leaves
 * it, and upgraded again when it comes back; nothing has to be cleaned up or re-subscribed.
 *
 * Every other recipient resolves `{ seat: false }` and keeps exactly the behaviour they had.
 *
 * Release gate: all of this applies only while the tenant is served the `co-managed-seat`
 * capability (`seatBoundaryApplies`). Closed, every recipient resolves `{ seat: false }` before
 * any seat row is read, so email, in-app notifications, watchers and inbound replies behave as
 * if this boundary did not exist. Open, the cost for a recipient who is not a seat technician is
 * one indexed read on `co_managed_seat_assignments` per batch.
 */
export type TicketNotificationRecipient =
  | { seat: false }
  | { seat: true; userId: string; reader: Extract<CommentAudienceReader, { kind: 'seat' | 'requester' }> };

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

/** Served decisions that positively close the seat shape for a tenant. */
const SEAT_CAPABILITY_CLOSED: ReadonlySet<CapabilityReason> = new Set<CapabilityReason>([
  'forced-off', 'forced-malformed', 'not-participating',
]);

/**
 * Does the recipient boundary apply to this tenant? It follows `serves('co-managed-seat')`:
 * delivering to, and hearing back from, technicians who already hold a seat is existing state,
 * so it never depends on the rollout flag evaluator.
 *
 * The gate reports "not served" both when it decided so (`FORCE_CAPABILITIES=co-managed-seat:off`,
 * or a tenant with no seat arrangement) and when it could not decide (the participation read
 * failed, or this process never registered the resolver). Only a decision switches the boundary
 * off. Undecided, the seat rows are read as usual: the boundary's failure mode is to withhold
 * from a seat technician, never to hand them what MSP staff are sent.
 */
async function seatBoundaryApplies(tenant: string): Promise<boolean> {
  const decision = await serves('co-managed-seat', tenant);
  return decision.served || !SEAT_CAPABILITY_CLOSED.has(decision.reasons.served);
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
 * Nothing is read, and nobody is a seat technician, while the capability is closed.
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
  if (!(await seatBoundaryApplies(tenant))) return recipients.map(() => NOT_SEAT);

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
    const reader: Extract<CommentAudienceReader, { kind: 'seat' | 'requester' }> =
      seat.arrangement_id && inScope.has(seat.arrangement_id) && seat.client_id
        ? { kind: 'seat', tenant, clientId: seat.client_id } : { kind: 'requester', tenant };
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

/** One message of a planned envelope: who it is addressed to and who that primary recipient is. */
export interface TicketEnvelopeMessage<A extends { email: string }> {
  to: string;
  /** True when `to` is the envelope's own `To`, so the caller's recipient-specific fields still apply. */
  original: boolean;
  recipient: TicketNotificationRecipient;
  cc: A[];
  bcc: A[];
}

/**
 * Splits one ticket envelope (To, Cc, Bcc) into the messages that may carry it.
 *
 * A message is rendered once, for its `To`, so an address in Cc or Bcc reads whatever the `To`
 * was shown. A seat technician therefore never shares a message: each one found anywhere on the
 * envelope gets a message of their own, with no Cc or Bcc, which the caller admits or refuses
 * with `selectAudienceContent` exactly as it would a `To`. Everyone else stays together on what
 * is left of the envelope. If the `To` was the technician, the first remaining Cc is promoted to
 * `To`; a Bcc-only remainder becomes one message per address, because a message with no `To` is
 * rejected by some providers.
 *
 * With no seat technician on the envelope the result is the envelope itself, unchanged: one
 * message, the same lists. All addresses are resolved in one read.
 */
export async function planTicketEnvelope<A extends { email: string }>(
  trx: Knex | Knex.Transaction,
  tenant: string,
  ticket: NotificationTicket,
  envelope: { to: NotificationRecipientKey & { email: string }; cc?: readonly A[]; bcc?: readonly A[] },
): Promise<TicketEnvelopeMessage<A>[]> {
  const cc = [...(envelope.cc ?? [])];
  const bcc = [...(envelope.bcc ?? [])];
  const [toRecipient, ...copied] = await resolveTicketNotificationRecipients(
    trx, tenant, ticket, [envelope.to, ...cc.map(a => ({ email: a.email })), ...bcc.map(a => ({ email: a.email }))],
  );
  const ccRecipients = copied.slice(0, cc.length);
  const bccRecipients = copied.slice(cc.length);
  if (!toRecipient.seat && copied.every(recipient => !recipient.seat)) {
    return [{ to: envelope.to.email, original: true, recipient: toRecipient, cc, bcc }];
  }

  const sharedCc = cc.filter((_, index) => !ccRecipients[index].seat);
  const sharedBcc = bcc.filter((_, index) => !bccRecipients[index].seat);
  const messages: TicketEnvelopeMessage<A>[] = [];
  const seatsPlanned = new Set<string>();
  if (!toRecipient.seat) {
    messages.push({ to: envelope.to.email, original: true, recipient: toRecipient, cc: sharedCc, bcc: sharedBcc });
  } else {
    seatsPlanned.add(toRecipient.userId);
    messages.push({ to: envelope.to.email, original: true, recipient: toRecipient, cc: [], bcc: [] });
    if (sharedCc.length > 0) {
      const [promoted, ...remainingCc] = sharedCc;
      messages.push({ to: promoted.email, original: false, recipient: NOT_SEAT, cc: remainingCc, bcc: sharedBcc });
    } else {
      for (const address of sharedBcc) messages.push({ to: address.email, original: false, recipient: NOT_SEAT, cc: [], bcc: [] });
    }
  }
  [...cc, ...bcc].forEach((address, index) => {
    const recipient = copied[index];
    if (!recipient.seat || seatsPlanned.has(recipient.userId)) return;
    seatsPlanned.add(recipient.userId);
    messages.push({ to: address.email, original: false, recipient, cc: [], bcc: [] });
  });
  return messages;
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
 * Not a seat technician: always, the caller's existing rules stand. A seat technician: only what
 * `isCommentAudienceVisible` shows their reader (their client's `shared_it` too while in scope,
 * `requester` only as an external party). A message that does not say what it carries
 * (`audience` missing) is never sent to them.
 *
 * Ticket-level facts (title, status, assignment) are `requester`: everyone admitted to the ticket.
 */
export function recipientMayReceive(
  recipient: TicketNotificationRecipient,
  audience: CommentAudience | null | undefined,
): boolean {
  if (!recipient.seat) return true;
  const reader = recipient.reader;
  if (!isCommentAudience(audience)) return false;
  return isCommentAudienceVisible(
    audience, { tenant: reader.tenant, clientId: reader.kind === 'seat' ? reader.clientId : null }, reader);
}

/**
 * Is the ticket in this recipient's scope? True for everyone who is not a seat technician and for
 * a seat technician whose reader is `seat`. False for the one who is an external party here. It
 * does NOT mean "may receive requester content": everyone may, an external party included.
 */
export function recipientInScope(recipient: TicketNotificationRecipient): boolean {
  return !recipient.seat || recipient.reader.kind === 'seat';
}

/**
 * Which rendering of a ticket message this recipient gets: `msp` (MSP link, internal-user
 * template) or `client` (portal link, client template). An out-of-scope seat technician is an
 * external party and gets `client`; everyone else keeps `msp` or `client` by their own type.
 */
export function recipientRendering(recipient: TicketNotificationRecipient): 'msp' | 'client' {
  return recipientInScope(recipient) ? 'msp' : 'client';
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
 * or is not admitted (an external party's reader admits `requester` only). A message that
 * declares no rendering is never sent to them.
 */
export async function selectAudienceContent<T>(
  recipient: TicketNotificationRecipient,
  renderings: ReadonlyArray<AudienceContent<T>> | null | undefined,
): Promise<{ admitted: false } | { admitted: true; selected?: { audience: CommentAudience; content?: T } }> {
  if (!recipient.seat) return { admitted: true };
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

/** What to do with an email reply, once its sender is known to be an internal user. */
export type InboundReplyAudience =
  /** Not a seat technician: the native reply rules stand. */
  | { seat: false }
  /**
   * A seat technician. In scope the reply is written as a `seat` author; out of scope as an
   * external `requester` author, with `requester` audience. The reply is stored with `audience`, written as `author`. It
   * joins the thread it answers only while that thread still has this audience; otherwise it
   * starts a new thread, so a later audience change never widens what the technician wrote.
   */
  | { seat: true; author: CommentAudienceReader; audience: CommentAudience; joinThread: boolean };

/**
 * The audience of a seat technician's email reply: the audience of the notification they answered.
 *
 *   - `notificationAudience` is what the reply token recorded when the notification was sent
 *     (`NOTIFICATION_AUDIENCE_TOKEN_KEY`). A reply matched by thread headers has none and takes
 *     the audience of the thread it answers; with no thread it is a new `requester` comment, as
 *     an email reply to a ticket has always been.
 *   - An audience the technician may not write (a private or legacy internal thread they were
 *     never notified of) is never used: in scope the reply becomes a new `shared_it` thread, the
 *     narrowest audience their organization has; as an external party it becomes a new `requester`
 *     one. A reply is never refused.
 *
 * The write itself is still decided by `assertCommentWriteAudience` in the comment writer; this
 * only chooses what to ask it for.
 */
export async function resolveInboundReplyAudience(
  trx: Knex | Knex.Transaction,
  tenant: string,
  input: { ticketId: string; userId: string; threadId?: string | null; notificationAudience?: CommentAudience | null },
): Promise<InboundReplyAudience> {
  const recipient = await resolveTicketNotificationRecipient(trx, tenant, { ticketId: input.ticketId }, { userId: input.userId });
  if (!recipient.seat) return { seat: false };
  let threadAudience: CommentAudience | null = null;
  if (input.threadId) {
    const db = tenantDb(trx, tenant);
    const query = db.table('comment_threads as t').where('t.thread_id', input.threadId).where('t.ticket_id', input.ticketId);
    db.tenantJoin(query, 'comments as root', 't.root_comment_id', 'root.comment_id', { type: 'left' });
    const thread = await query.first({
      collaboration_audience: 't.collaboration_audience', is_internal: 't.is_internal',
      root_comment_id: 'root.comment_id', root_is_internal: 'root.is_internal',
    });
    threadAudience = thread ? resolveCommentAudienceForRead({
      collaboration_audience: thread.collaboration_audience,
      is_internal: thread.is_internal,
      root_is_internal: thread.root_comment_id ? thread.root_is_internal : undefined,
    }) : 'organization_private';
  }

  const intended = input.notificationAudience ?? threadAudience ?? 'requester';
  const audience = recipientMayReceive(recipient, intended) ? intended : recipientInScope(recipient) ? 'shared_it' : 'requester';
  return { seat: true, author: recipient.reader, audience, joinThread: threadAudience === audience };
}
