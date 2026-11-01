import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { isCoManagedWorkspace } from '@alga-psa/db/writeAdmission';

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
 *   2. Every reader (portal, search ACL/indexer, private reads) reuses
 *      `commentAudienceSql` / `isCommentAudienceVisible`. There is no second predicate.
 */
export const COMMENT_AUDIENCES = ['requester', 'shared_it', 'organization_private'] as const;
export type CommentAudience = (typeof COMMENT_AUDIENCES)[number];

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

/** Audiences a native (non-collaboration) command may name. Shared IT needs the co-managed command's authority. */
export type NativeCommentAudience = Extract<CommentAudience, 'requester' | 'organization_private'>;

export function isCommentAudience(value: unknown): value is CommentAudience {
  return typeof value === 'string' && (COMMENT_AUDIENCES as readonly string[]).includes(value);
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
 * Audience is an additional restriction after resource and principal authorization.
 * `ownerTenant` is the tenant that stores the comment; `actorTenant` is the reader's.
 * A requester only ever sees `requester`. Anything missing fails closed.
 */
export function isCommentAudienceVisible(audience: CommentAudience, ownerTenant: string, actorTenant: string, requester = false): boolean {
  if (!ownerTenant || !actorTenant || !isCommentAudience(audience)) return false;
  if (requester) return audience === 'requester';
  return audience === 'requester' || audience === 'shared_it' || (audience === 'organization_private' && ownerTenant === actorTenant);
}

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
 */
export async function nativeThreadAudience(
  trx: Knex | Knex.Transaction,
  tenant: string,
  input: { isInternal: boolean; authorType: string; audience?: string | null },
): Promise<{ collaboration_audience?: NativeCommentAudience }> {
  const named = input.audience;
  if (named != null && ((named !== 'requester' && named !== 'organization_private') || input.isInternal !== (named !== 'requester'))) {
    throw new CommentAudienceError();
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
 * A native text edit may neither relabel a labelled thread nor publish a legacy note in a
 * co-managed workspace (that would be an unaudited requester-visible comment).
 * Called only when the edit actually changes `is_internal`; unchanged edits cost nothing.
 */
export async function assertNativeEditKeepsAudience(
  trx: Knex | Knex.Transaction,
  tenant: string,
  thread: { collaboration_audience?: unknown } | null | undefined,
  next: { isInternal: boolean },
): Promise<void> {
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
