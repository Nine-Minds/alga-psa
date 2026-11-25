import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { isCoManagedWorkspace } from '@alga-psa/db/writeAdmission';
import {
  contentAudienceVisibleSql, isContentAudience, isContentAudienceVisible,
  contentAudiencesVisibleTo,
  type ContentAudience, type ContentAudienceOwner, type ContentAudienceReader,
} from './contentAudience';

/**
 * Conversation audiences for shared (co-managed) work.
 *
 * The audience lives on the THREAD (`comment_threads.collaboration_audience`); replies
 * inherit it. NULL means "legacy" and resolves through today's `is_internal` rule, so a
 * legacy internal note is `organization_private` and is never inferred to be `shared_it`.
 *
 * Two rules are load-bearing:
 *   1. Audience is an ADDITIONAL restriction applied after resource/principal
 *      authorization. It never grants anything.
 *   2. Every reader (portal, search ACL/indexer, private reads) reuses the content-audience
 *      predicate (`isContentAudienceVisible` / `contentAudienceVisibleSql`, `contentAudience.ts`)
 *      over the audience resolved by `resolveCommentAudienceForRead` / `commentAudienceSql`.
 *      There is no second predicate.
 *   3. Visibility is keyed on the reader's ORGANIZATION (`ContentAudienceReader`), not their
 *      tenant: a seat technician is an internal user of the owning tenant and still not its staff.
 *   4. Writes go through the same organizations. Every native writer asks `nativeThreadAudience`
 *      (new thread) or `nativeReplyAudience` (reply); both decide through
 *      `assertCommentWriteAudience`, the write twin of `isContentAudienceVisible`. A thread's
 *      audience changes only through `changeThreadAudience`.
 */
export type CommentAudience = ContentAudience;

export class CommentAudienceError extends Error {
  readonly code = 'COMMENT_AUDIENCE_INVALID' as const;
  constructor() {
    super('This comment does not have a valid audience for the requested operation.');
    this.name = 'CommentAudienceError';
  }
}

/** A co-managed workspace's requester-visible comment that did not name its audience. */
export class CoManagedAudienceRequiredError extends Error {
  readonly code = 'CO_MANAGED_AUDIENCE_REQUIRED' as const;
  constructor() {
    super('Choose who can see this comment before posting it.');
    this.name = 'CoManagedAudienceRequiredError';
  }
}

/** A thread audience change that widens who can read it and was not explicitly confirmed. */
export class CommentAudienceConfirmationRequiredError extends Error {
  readonly code = 'COMMENT_AUDIENCE_CONFIRMATION_REQUIRED' as const;
  constructor() {
    super('Confirm that more people will be able to read this conversation before sharing it.');
    this.name = 'CommentAudienceConfirmationRequiredError';
  }
}

/**
 * Audiences a native (non-collaboration) command may name. `shared_it` is admitted only on a
 * ticket of a client with a live seat arrangement (`assertCommentWriteAudience`); a co-managed
 * workspace has no such arrangement, so there it still needs the co-managed command's authority.
 */
export type NativeCommentAudience = CommentAudience;

export function isCommentAudience(value: unknown): value is CommentAudience {
  return isContentAudience(value);
}

/** The `is_internal` value a stored audience implies. Only `requester` is public. */
export function audienceIsInternal(audience: CommentAudience): boolean {
  return audience !== 'requester';
}

export interface AudienceRow {
  /** `comment_threads.collaboration_audience` (NULL = legacy). */
  collaboration_audience?: unknown;
  /** `comment_threads.is_internal`. */
  is_internal?: unknown;
  /** Root comment's `is_internal`, when the reader has it. */
  root_is_internal?: unknown;
  /** The comment's own `is_internal`, when the reader has it. */
  comment_is_internal?: unknown;
}

/**
 * WRITE-side resolution: rejects inconsistent rows. NULL + `is_internal === false` is
 * `requester`; NULL + anything else is `organization_private`.
 */
export function resolveCommentAudience(thread: AudienceRow): CommentAudience {
  const audience = thread.collaboration_audience;
  if (audience == null) return thread.is_internal === false ? 'requester' : 'organization_private';
  if (!isCommentAudience(audience) || thread.is_internal !== audienceIsInternal(audience)) throw new CommentAudienceError();
  return audience;
}

/**
 * READ-side resolution: the TypeScript twin of `commentAudienceSql`. Never throws; any
 * row whose thread, root and comment flags disagree with each other or with the stored
 * audience resolves `organization_private`, so a damaged row can only narrow visibility.
 */
export function resolveCommentAudienceForRead(row: AudienceRow): CommentAudience {
  const flags = [row.is_internal, row.root_is_internal ?? row.is_internal, row.comment_is_internal ?? row.root_is_internal ?? row.is_internal];
  const audience = row.collaboration_audience;
  if (flags.every(flag => flag === false) && (audience == null || audience === 'requester')) return 'requester';
  if (flags.every(flag => flag === true) && audience === 'shared_it') return 'shared_it';
  return 'organization_private';
}

/**
 * The reader organization of one user of `tenant`.
 *
 * A client user is the requester. An internal user is MSP staff unless a seat assignment names
 * them: a live one (active assignment on an active arrangement) makes them that client's seat
 * technician. An assignment that is not live and not revoked (arrangement ended, invitation not
 * yet active) resolves `null`, which every predicate treats as "sees nothing": such a user is
 * never promoted to MSP staff. A revoked assignment no longer binds the user (revocation
 * deactivates them; conversion to an MSP user ends the assignment).
 *
 * One read on `co_managed_one_live_seat_assignment (tenant, user_id)`. Callers that read many
 * comments resolve the reader once per request, never per comment.
 */
export async function resolveCommentAudienceReader(
  trx: Knex | Knex.Transaction,
  tenant: string,
  user: { userId: string; userType: string },
): Promise<ContentAudienceReader | null> {
  if (!tenant || !user?.userId) return null;
  if (user.userType === 'client') return { kind: 'requester', tenant };
  if (user.userType !== 'internal') return null;
  const db = tenantDb(trx, tenant);
  const query = db.table('co_managed_seat_assignments as sa')
    .where('sa.user_id', user.userId).whereNot('sa.state', 'revoked');
  db.tenantJoin(query, 'co_managed_seat_arrangements as ar', 'sa.arrangement_id', 'ar.arrangement_id', { type: 'left' });
  db.tenantJoin(query, 'co_managed_unavailable_trial_assignments as blocked', 'blocked.assignment_id', 'sa.assignment_id', { type: 'left' });
  const seat = await query.first({ blocked: 'blocked.assignment_id', assignment_state: 'sa.state', arrangement_state: 'ar.state', client_id: 'ar.client_id' });
  if (!seat) return { kind: 'staff', tenant };
  if (seat.blocked || seat.assignment_state !== 'active' || seat.arrangement_state !== 'active' || !seat.client_id) return null;
  return { kind: 'seat', tenant, clientId: seat.client_id };
}

/**
 * The internal user a read is for, as the caller holds them: the user id alone, or the user row
 * the request already loaded (`getCurrentUser` reads it from the database on every request).
 *
 * The row carries `seat_reader`, which a foreign key keeps `true` for every user bound by a seat
 * assignment that is not revoked (migration 20261113130000). So `seat_reader === false` on a
 * loaded row is the one thing that says "MSP staff" with no statement. A bare id, a row without
 * the column, or `true` says nothing either way, and the read then asks the seat tables in the
 * statement it already runs. Nothing else decides who is staff: not the capability gate, not a
 * cache, so a process that never registered the co-managed capability and a tenant whose first
 * seat was bound a moment ago are read the same as any other.
 */
export type InternalReaderIdentity = string | { user_id: string; seat_reader?: boolean | null };

const internalReaderUserId = (reader: InternalReaderIdentity): string => typeof reader === 'string' ? reader : reader.user_id;
/** True only for a loaded user row whose marker says no seat assignment binds the user. */
export const isKnownStaffReader = (reader: InternalReaderIdentity): boolean =>
  typeof reader !== 'string' && reader.seat_reader === false;

/**
 * `resolveCommentAudienceReader` for a request boundary that holds the user row (search): an
 * internal user whose row says no seat assignment binds them is staff, with no SQL. Any other
 * internal user is resolved from the seat tables.
 */
export async function admitCommentAudienceReader(
  trx: Knex | Knex.Transaction,
  tenant: string,
  user: { userId: string; userType: string; seatReader?: boolean | null },
): Promise<ContentAudienceReader | null> {
  if (tenant && user?.userId && user.userType === 'internal' && user.seatReader === false) {
    return { kind: 'staff', tenant };
  }
  return resolveCommentAudienceReader(trx, tenant, user);
}

/**
 * The author a native comment write is decided for, from the user row the entry point already holds.
 *
 * An internal user is resolved with `admitCommentAudienceReader` (staff with zero SQL when
 * `seat_reader === false`; a seat technician is their client's seat reader, so
 * `assertCommentWriteAudience` refuses them Private and the legacy internal note). Any other
 * principal (a client user, a service principal) returns `undefined`: the write keeps the author
 * its `authorType` has always implied, so those paths behave exactly as before.
 */
export async function resolveCommentWriteAuthor(
  trx: Knex | Knex.Transaction,
  tenant: string,
  user: { user_id: string; user_type?: string | null; seat_reader?: boolean | null },
): Promise<ContentAudienceReader | null | undefined> {
  if (user.user_type !== 'internal') return undefined;
  return admitCommentAudienceReader(trx, tenant, { userId: user.user_id, userType: 'internal', seatReader: user.seat_reader });
}

/** The owning organization as a WRITE sees it: the read owner plus whether its client has a live seat arrangement. */
export interface CommentWriteOwner extends ContentAudienceOwner {
  /** The ticket's client has an active seat arrangement. Only then does `shared_it` exist. */
  seatArrangement?: boolean;
}

/**
 * Write twin of `isContentAudienceVisible`: may `author` store a native comment with this
 * audience on a ticket of `owner`? Throws `CommentAudienceError`; never substitutes an audience.
 *
 *   - Nobody writes what they could not read back (the read predicate, applied to the author).
 *     That alone refuses a seat technician `organization_private` and the legacy internal note
 *     (internal, no audience named, which resolves private), and keeps them to their own client.
 *   - A native write belongs to the owning tenant: another tenant's staff use the co-managed command.
 *   - `shared_it` exists only where the ticket's client has a live seat arrangement.
 *
 * `audience` null is the legacy form: `requester` when public, `organization_private` when internal.
 */
export function assertCommentWriteAudience(
  author: ContentAudienceReader | null | undefined,
  owner: CommentWriteOwner,
  write: { audience?: CommentAudience | null; isInternal: boolean },
): CommentAudience {
  const named = write.audience ?? null;
  if (named != null && (!isCommentAudience(named) || write.isInternal !== audienceIsInternal(named))) throw new CommentAudienceError();
  const audience: CommentAudience = named ?? (write.isInternal ? 'organization_private' : 'requester');
  if (!author || author.tenant !== owner?.tenant || !isContentAudienceVisible(audience, owner, author)) throw new CommentAudienceError();
  if (audience === 'shared_it' && owner.seatArrangement !== true) throw new CommentAudienceError();
  return audience;
}

/** `shared_it` is narrower than `requester` and wider than `organization_private`. */
const AUDIENCE_REACH: Record<CommentAudience, number> = { organization_private: 0, shared_it: 1, requester: 2 };

/** True when moving a thread from `from` to `to` lets someone new read it. */
export function isCommentAudienceWidening(from: CommentAudience, to: CommentAudience): boolean {
  return AUDIENCE_REACH[to] > AUDIENCE_REACH[from];
}

/**
 * The owning organization of one ticket for a write: its client, and whether that client has a
 * live (active) seat arrangement. Two indexed reads, paid only by writes that need the answer
 * (a seat author, or `shared_it`): never by an MSP comment that names neither.
 */
export async function resolveCommentWriteOwner(
  trx: Knex | Knex.Transaction,
  tenant: string,
  ticketId: string | null | undefined,
): Promise<CommentWriteOwner> {
  if (!tenant || !ticketId) return { tenant };
  const db = tenantDb(trx, tenant);
  const ticket = await db.table('tickets').where('ticket_id', ticketId).first('client_id');
  if (!ticket?.client_id) return { tenant };
  const arrangement = await db.table('co_managed_seat_arrangements')
    .where({ client_id: ticket.client_id, state: 'active' }).first('arrangement_id');
  return { tenant, clientId: ticket.client_id, seatArrangement: !!arrangement };
}

/**
 * The owning organization of one project task for a write: the client of its project, and whether that client has a
 * live seat arrangement. The task twin of `resolveCommentWriteOwner`, so a task thread is judged by the same
 * predicates as a ticket thread; the kernel's own project decision has already admitted the author to the project.
 */
export async function resolveTaskCommentWriteOwner(
  trx: Knex | Knex.Transaction,
  tenant: string,
  taskId: string | null | undefined,
): Promise<CommentWriteOwner> {
  if (!tenant || !taskId) return { tenant };
  const db = tenantDb(trx, tenant);
  const query = db.table('project_tasks as pt');
  db.tenantJoin(query, 'project_phases as pp', 'pt.phase_id', 'pp.phase_id');
  db.tenantJoin(query, 'projects as p', 'pp.project_id', 'p.project_id');
  const project = await query.where('pt.task_id', taskId).first('p.client_id');
  if (!project?.client_id) return { tenant };
  const arrangement = await db.table('co_managed_seat_arrangements')
    .where({ client_id: project.client_id, state: 'active' }).first('arrangement_id');
  return { tenant, clientId: project.client_id, seatArrangement: !!arrangement };
}

/** Who is writing a native comment, and on which ticket or task. */
export interface NativeCommentAuthor {
  /**
   * The author's organization (`resolveCommentAudienceReader`), resolved once per request by an
   * entry point that admits seat principals. `null` is a principal with no live organization and
   * writes nothing. Omitted, the author is the organization `authorType` has always implied
   * (owning-tenant staff for `internal`), which costs no SQL.
   */
  author?: ContentAudienceReader | null;
  /** The ticket written to. Required for a seat author and for `shared_it` on a ticket. */
  ticketId?: string | null;
  /** The project task written to, instead of a ticket. Required for a seat author and for `shared_it` on a task. */
  taskId?: string | null;
}

const writeOwnerOf = (trx: Knex | Knex.Transaction, tenant: string, target: NativeCommentAuthor): Promise<CommentWriteOwner> =>
  target.taskId ? resolveTaskCommentWriteOwner(trx, tenant, target.taskId) : resolveCommentWriteOwner(trx, tenant, target.ticketId);

/**
 * Thread audience column for a native top-level comment.
 *
 * Fast path (zero SQL): an internal note, a plain (non-staff) author, and every tenant
 * that is not a co-managed workspace. Workspace membership comes from L0's
 * write-admission cache (`isCoManagedWorkspace`): a PSA tenant is remembered after at
 * most one `tenants.product_code` read per process, never one per comment.
 *
 * In a co-managed workspace a staff comment the requester can read must say so: a missing
 * audience FAILS CLOSED with CO_MANAGED_AUDIENCE_REQUIRED instead of defaulting.
 *
 * Seat shape: a seat author, and anyone naming `shared_it`, is decided by
 * `assertCommentWriteAudience` against the ticket's organization. Only those writes read it.
 */
export async function nativeThreadAudience(
  trx: Knex | Knex.Transaction,
  tenant: string,
  input: { isInternal: boolean; authorType: string; audience?: string | null } & NativeCommentAuthor,
): Promise<{ collaboration_audience?: NativeCommentAudience }> {
  const named = input.audience;
  if (named != null && (!isCommentAudience(named) || input.isInternal !== audienceIsInternal(named))) {
    throw new CommentAudienceError();
  }
  if (input.author !== undefined || named === 'shared_it') {
    const author = input.author !== undefined ? input.author
      : input.authorType === 'internal' ? { kind: 'staff' as const, tenant } : null;
    if (!author) throw new CommentAudienceError();
    const owner = author.kind === 'seat' || named === 'shared_it'
      ? await writeOwnerOf(trx, tenant, input) : { tenant };
    assertCommentWriteAudience(author, owner, { audience: named as CommentAudience | null | undefined, isInternal: input.isInternal });
    if (named === 'shared_it') return { collaboration_audience: 'shared_it' };
  }
  if (named == null && (input.isInternal || input.authorType !== 'internal')) return {};
  if (!(await isCoManagedWorkspace(trx, tenant))) return {};
  if (named == null) throw new CoManagedAudienceRequiredError();
  return { collaboration_audience: named as NativeCommentAudience };
}

/**
 * Reply guard over an already-read thread row. Replies inherit the thread's audience;
 * a reply that names a different visibility is refused. No SQL: callers pass the thread
 * they already joined for the parent lookup.
 */
export function assertReplyAudience(
  thread: { collaboration_audience?: unknown; is_internal?: unknown },
  reply: { isInternal?: boolean | null; audience?: string | null },
): CommentAudience {
  const audience = resolveCommentAudience(thread);
  if (reply.audience != null && reply.audience !== audience) throw new CommentAudienceError();
  if (thread.collaboration_audience != null && reply.isInternal != null && reply.isInternal !== audienceIsInternal(audience)) {
    throw new CommentAudienceError();
  }
  return audience;
}

/**
 * Locks a LABELLED thread for a reply or tombstone so an audience change serialises
 * against it. Legacy (NULL) threads cannot change audience, so they take no lock and no
 * extra statement.
 */
export async function lockLabelledThreadAudience(
  trx: Knex.Transaction,
  tenant: string,
  thread: { thread_id: string; collaboration_audience?: unknown },
): Promise<CommentAudience | null> {
  if (thread.collaboration_audience == null) return null;
  if (!trx.isTransaction) throw new Error('Comment audience checks require the owning transaction');
  const locked = await tenantDb(trx, tenant).table('comment_threads')
    .where('thread_id', thread.thread_id).forUpdate().first('collaboration_audience', 'is_internal');
  if (!locked) throw new CommentAudienceError();
  return resolveCommentAudience(locked);
}

/**
 * Audience of a native REPLY: the thread's, for every organization. Returns the labelled
 * audience, or `null` for a legacy thread (which stores nothing and takes no lock).
 *
 * A named author must be able to read the thread they reply into, so a seat technician cannot
 * reply into a private or legacy internal thread, nor on another client's ticket. A requester
 * author keeps today's rule at the call site (a client reply to an internal thread starts a
 * fresh public thread). With no author named and a legacy thread this is zero SQL.
 */
export async function nativeReplyAudience(
  trx: Knex | Knex.Transaction,
  tenant: string,
  thread: { thread_id: string; collaboration_audience?: unknown; is_internal?: unknown },
  reply: { isInternal?: boolean | null; audience?: string | null } & NativeCommentAuthor,
): Promise<CommentAudience | null> {
  if (reply.author !== undefined && reply.author?.kind !== 'requester') {
    const author = reply.author;
    if (!author || author.tenant !== tenant) throw new CommentAudienceError();
    const owner = author.kind === 'seat' ? await writeOwnerOf(trx, tenant, reply) : { tenant };
    if (!isContentAudienceVisible(resolveCommentAudienceForRead(thread), owner, author)) throw new CommentAudienceError();
  }
  if (thread.collaboration_audience == null) return null;
  await lockLabelledThreadAudience(trx as Knex.Transaction, tenant, thread);
  return assertReplyAudience(thread, reply);
}

/**
 * Changes a ticket thread's audience in place. The only way a stored audience changes.
 *
 *   - Only staff of the owning tenant. A seat technician, a requester and a principal with no
 *     live organization are refused, whatever the direction.
 *   - Widening (`isCommentAudienceWidening`) discloses every comment already in the thread, so it
 *     needs `confirmDisclosure: true`; without it COMMENT_AUDIENCE_CONFIRMATION_REQUIRED.
 *   - `shared_it` needs the ticket's client to have a live seat arrangement.
 *   - A legacy (NULL) thread is labelled by its first change. A thread holding a comment that
 *     disagrees with it, or one not yet published, is refused rather than relabelled.
 *
 * Runs under the thread row lock replies take (`lockLabelledThreadAudience`). Co-managed
 * workspaces change audience through their own disclosure command, which also moves files.
 */
export async function changeThreadAudience(
  trx: Knex.Transaction,
  tenant: string,
  input: { threadId: string; audience: string; author: ContentAudienceReader | null | undefined; confirmDisclosure?: boolean },
): Promise<{ previous: CommentAudience; audience: CommentAudience; changed: boolean }> {
  if (!trx.isTransaction) throw new Error('Comment audience checks require the owning transaction');
  const { author, audience } = input;
  if (author?.kind !== 'staff' || author.tenant !== tenant || !isCommentAudience(audience)) throw new CommentAudienceError();
  if (await isCoManagedWorkspace(trx, tenant)) throw new CommentAudienceError();
  const db = tenantDb(trx, tenant);
  const thread = await db.table('comment_threads').where('thread_id', input.threadId).whereNotNull('ticket_id')
    .forUpdate().first('thread_id', 'ticket_id', 'collaboration_audience', 'is_internal');
  if (!thread) throw new CommentAudienceError();
  const previous = resolveCommentAudience(thread);
  if (previous === audience) return { previous, audience, changed: false };
  const comments = await db.table('comments').where('thread_id', input.threadId).forUpdate().select('is_internal', 'publish_state');
  if (comments.some(row => row.is_internal !== thread.is_internal || row.publish_state !== 'published')) throw new CommentAudienceError();
  if (isCommentAudienceWidening(previous, audience) && input.confirmDisclosure !== true) throw new CommentAudienceConfirmationRequiredError();
  assertCommentWriteAudience(author, await resolveCommentWriteOwner(trx, tenant, thread.ticket_id),
    { audience, isInternal: audienceIsInternal(audience) });
  const isInternal = audienceIsInternal(audience);
  await db.table('comment_threads').where('thread_id', input.threadId).update({ collaboration_audience: audience, is_internal: isInternal });
  if (isInternal !== thread.is_internal) await db.table('comments').where('thread_id', input.threadId).update({ is_internal: isInternal });
  return { previous, audience, changed: true };
}

/**
 * A native text edit may neither relabel a labelled thread nor publish a legacy note in a
 * co-managed workspace (that would be an unaudited requester-visible comment).
 * Called only when the edit actually changes `is_internal`; unchanged edits cost nothing.
 */
export async function assertNativeEditKeepsAudience(
  trx: Knex | Knex.Transaction,
  tenant: string,
  thread: { collaboration_audience?: unknown } | null | undefined,
  next: { isInternal: boolean; author?: ContentAudienceReader | null },
): Promise<void> {
  // A seat technician can hold neither side of a legacy flip: internal would be a legacy internal note.
  if (next.author !== undefined && next.author?.kind !== 'staff') throw new CommentAudienceError();
  if (thread?.collaboration_audience != null) throw new CommentAudienceError();
  if (!next.isInternal && await isCoManagedWorkspace(trx, tenant)) throw new CoManagedAudienceRequiredError();
}

/**
 * SQL facet of audience resolution: 'requester' | 'shared_it' | 'organization_private'.
 * Requires thread, root and comment flags to agree before returning anything wider than
 * private, so inconsistent legacy rows are private. Aliases are supplied by the query
 * adapter, never a request. Identifiers are bound (`??`), never interpolated.
 */
export function commentAudienceSql(
  db: Knex | Knex.Transaction,
  threadAlias: string,
  rootAlias: string,
  commentAlias = rootAlias,
): Knex.Raw {
  return db.raw(`CASE
    WHEN ??.is_internal IS FALSE AND ??.is_internal IS FALSE AND ??.is_internal IS FALSE
      AND (??.collaboration_audience IS NULL OR ??.collaboration_audience = 'requester') THEN 'requester'
    WHEN ??.is_internal IS TRUE AND ??.is_internal IS TRUE AND ??.is_internal IS TRUE
      AND ??.collaboration_audience = 'shared_it' THEN 'shared_it'
    ELSE 'organization_private' END`,
  [threadAlias, rootAlias, commentAlias, threadAlias, threadAlias, threadAlias, rootAlias, commentAlias, threadAlias]);
}

/** Where a query exposes the comment's audience and its owning organization. */
export interface CommentAudienceSqlSource {
  /** `comment_threads` alias. */
  thread: string;
  /** Alias of the thread's root comment. */
  root: string;
  /** Alias of the comment being read; defaults to the root. */
  comment?: string;
  /** Column holding the tenant that stores the comment, e.g. `'c.tenant'`. */
  ownerTenant: string;
  /** Column holding the ticket's client, e.g. `'t.client_id'`. Required for a seat reader. */
  ownerClient?: string;
}

/**
 * The comment caller of `contentAudienceVisibleSql`: derives the audience from thread, root and
 * comment (`commentAudienceSql`) and delegates. Comments add the derivation and nothing else.
 */
export function commentAudienceVisibleSql(
  db: Knex | Knex.Transaction,
  reader: ContentAudienceReader | null | undefined,
  source: CommentAudienceSqlSource,
): Knex.Raw {
  return contentAudienceVisibleSql(db, reader, {
    audience: commentAudienceSql(db, source.thread, source.root, source.comment ?? source.root),
    ownerTenant: source.ownerTenant,
    ownerClient: source.ownerClient,
  });
}

/**
 * How a comment note names an uploaded file: `<prefix><file id><suffix>` as a regular expression.
 * One shape for the note parser (`commentAttachmentFileIds`) and for `documentVisible`'s SQL.
 */
export const COMMENT_UPLOAD_URL_PATTERN = {
  prefix: '/api/documents/(?:view|download)/',
  suffix: '(?=[^0-9a-f-]|$)',
} as const;

/**
 * Audience visibility for one INTERNAL user of the owning tenant, decided inside the statement
 * that reads the rows: the SQL composition of `resolveCommentAudienceReader` and
 * `commentAudienceVisibleSql`. Read paths that cannot name the reader's organization before they
 * query (the ticket screen, the activity list, the attachment gate) add these expressions to the
 * statement they already run. They reach it only through `admitInternalReaderAudienceSql`, so a
 * reader known to be staff runs none of it.
 *
 *   staff           no seat assignment binds the user: every audience stored in their tenant
 *   commentVisible  staff, or a live seat technician of the comment's ticket's client reading an
 *                   audience `contentAudiencesVisibleTo('seat')` admits
 *
 *   documentVisible staff, or every comment that owns the document is `commentVisible`. A comment
 *                   owns a document through an attachment row, or, for comments saved before
 *                   attachment rows existed, by naming the document's file in an upload URL in its
 *                   note on a ticket the document is associated with. A document no comment owns
 *                   is not this predicate's to decide: it is visible here and keeps its own policy.
 *
 * A bound user whose assignment is not live sees nothing, as in `resolveCommentAudienceReader`.
 * A missing comment, thread, root or ticket fails closed for everyone but staff.
 */
function internalReaderAudienceSql(db: Knex | Knex.Transaction, tenant: string, userId: string) {
  const staff = db.raw(
    `NOT EXISTS (SELECT 1 FROM co_managed_seat_assignments aud_bound
      WHERE aud_bound.tenant = ? AND aud_bound.user_id = ? AND aud_bound.state <> 'revoked')`, [tenant, userId]);
  /** `commentId` is a uuid column (bound as an identifier) or a uuid-typed expression. */
  const commentVisible = (commentId: string | Knex.Raw): Knex.Raw => {
    const id = typeof commentId === 'string' ? db.raw('??', [commentId]) : commentId;
    return db.raw(`((?) OR EXISTS (SELECT 1 FROM comments aud_c
      JOIN comment_threads aud_ct ON aud_ct.tenant = aud_c.tenant AND aud_ct.thread_id = aud_c.thread_id
      JOIN comments aud_rc ON aud_rc.tenant = aud_ct.tenant AND aud_rc.comment_id = aud_ct.root_comment_id
      JOIN tickets aud_t ON aud_t.tenant = aud_c.tenant AND aud_t.ticket_id = aud_c.ticket_id
      JOIN co_managed_seat_arrangements aud_ar ON aud_ar.tenant = aud_c.tenant AND aud_ar.client_id = aud_t.client_id
        AND aud_ar.state = 'active'
      JOIN co_managed_seat_assignments aud_sa ON aud_sa.tenant = aud_c.tenant AND aud_sa.arrangement_id = aud_ar.arrangement_id
        AND aud_sa.user_id = ? AND aud_sa.state = 'active'
      WHERE NOT EXISTS (SELECT 1 FROM co_managed_unavailable_trial_assignments blocked WHERE blocked.tenant = aud_sa.tenant
        AND blocked.assignment_id = aud_sa.assignment_id)
        AND aud_c.tenant = ? AND aud_c.comment_id = (?) AND (?) = ANY(?::text[])))`,
    [staff, userId, tenant, id, commentAudienceSql(db, 'aud_ct', 'aud_rc', 'aud_c'), contentAudiencesVisibleTo('seat')]);
  };
  /** `documentId` is a uuid column (bound as an identifier) or a uuid-typed expression. */
  const documentVisible = (documentId: string | Knex.Raw): Knex.Raw => {
    const id = typeof documentId === 'string' ? db.raw('??', [documentId]) : documentId;
    // The note scan runs only for a seat reader, and only over the comments of the tickets the
    // document is associated with.
    return db.raw(`((?) OR (
      NOT EXISTS (SELECT 1 FROM ticket_comment_attachments aud_ca
        WHERE aud_ca.tenant = ? AND aud_ca.document_id = (?) AND NOT (?))
      AND NOT EXISTS (SELECT 1 FROM documents aud_d
        JOIN document_associations aud_da ON aud_da.tenant = aud_d.tenant AND aud_da.document_id = aud_d.document_id
          AND aud_da.entity_type = 'ticket'
        JOIN comments aud_oc ON aud_oc.tenant = aud_d.tenant AND aud_oc.ticket_id = aud_da.entity_id
          AND aud_oc.note ~* (? || aud_d.file_id::text || ?)
        WHERE aud_d.tenant = ? AND aud_d.document_id = (?) AND aud_d.file_id IS NOT NULL AND NOT (?))))`,
    [staff, tenant, id, commentVisible('aud_ca.comment_id'),
      COMMENT_UPLOAD_URL_PATTERN.prefix, COMMENT_UPLOAD_URL_PATTERN.suffix, tenant, id, commentVisible('aud_oc.comment_id')]);
  };
  return { staff, commentVisible, documentVisible };
}

export type InternalReaderAudienceSql = ReturnType<typeof internalReaderAudienceSql>;

/**
 * The audience expressions for one internal reader, or `null` when the reader is known to be MSP
 * staff (`isKnownStaffReader`): staff read every audience stored in their tenant, and the caller
 * adds no predicate and no seat table to its statement. For every other reader the expressions
 * decide staff or seat technician inside the caller's statement.
 */
export function admitInternalReaderAudienceSql(
  db: Knex | Knex.Transaction,
  tenant: string,
  reader: InternalReaderIdentity,
): InternalReaderAudienceSql | null {
  return isKnownStaffReader(reader) ? null : internalReaderAudienceSql(db, tenant, internalReaderUserId(reader));
}
