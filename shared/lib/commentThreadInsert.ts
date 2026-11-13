import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { nativeThreadAudience, type CommentAudience } from './commentAudience';

/**
 * The one write path for a NEW top-level ticket comment thread (`comment_threads` root row).
 *
 * Owns: resolving the thread audience, inserting the root row, and labelling the publication
 * payload. Reply handling (`lockLabelledThreadAudience` / `assertReplyAudience` / `reply_count`)
 * stays at the call sites; it is a different shape.
 */

export type ThreadAudienceSource =
  | { kind: 'native'; isInternal: boolean; authorType: string | null | undefined; requested: string | null | undefined }
  /** An audience the caller already resolved (e.g. `Comment.insert`'s co-managed command path). */
  | { kind: 'resolved'; audience: { collaboration_audience?: CommentAudience } };

/** Open on purpose: later work augments it via declaration merging (e.g. `conversationId`). */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface CommentThreadIntent {}

export interface CommentThreadInsertInput {
  threadId: string;
  ticketId: string;
  rootCommentId: string;
  isInternal: boolean;
  createdBy: string | null;
  at: Date | string;
  audience: ThreadAudienceSource;
  intent?: CommentThreadIntent;
}

export type CommentThreadRow = Record<string, unknown>;

export type CommentThreadInsertContributor = (
  trx: Knex | Knex.Transaction,
  tenant: string,
  row: Readonly<CommentThreadRow>,
  intent: CommentThreadIntent | undefined,
) => Promise<Record<string, unknown> | void> | Record<string, unknown> | void;

const KEY = '__algaCommentThreadInsertContributors';

function contributors(): CommentThreadInsertContributor[] {
  const g = globalThis as Record<string, unknown>;
  return (g[KEY] ??= []) as CommentThreadInsertContributor[];
}

/** Contributors run in registration order and merge extra columns into the inserted row. */
export function registerCommentThreadInsertContributor(contributor: CommentThreadInsertContributor): void {
  contributors().push(contributor);
}

/** Test-only. */
export function resetCommentThreadInsertContributors(): void {
  contributors().length = 0;
}

/**
 * `{}` with zero SQL natively (internal notes, plain authors, PSA tenants); fails closed in a
 * co-managed workspace when staff post a requester-visible comment without an audience.
 */
export async function resolveThreadAudience(
  trx: Knex | Knex.Transaction,
  tenant: string,
  source: ThreadAudienceSource,
): Promise<{ collaboration_audience?: CommentAudience }> {
  if (source.kind === 'resolved') return source.audience;
  return nativeThreadAudience(trx, tenant, {
    isInternal: source.isInternal,
    authorType: source.authorType as string,
    audience: source.requested,
  });
}

/** The `{ collaboration_audience, thread_id }` spread that labels a publication payload. Empty for legacy threads. */
export function commentThreadPayloadLabel(
  applied: { collaboration_audience?: CommentAudience | string | null } | null | undefined,
  threadId: string,
): { collaboration_audience?: CommentAudience; thread_id?: string } {
  return applied?.collaboration_audience
    ? { collaboration_audience: applied.collaboration_audience as CommentAudience, thread_id: threadId }
    : {};
}

/** Inserts the root `comment_threads` row and returns the applied audience (for payload labelling). */
export async function insertCommentThread(
  trx: Knex | Knex.Transaction,
  tenant: string,
  input: CommentThreadInsertInput,
): Promise<{ collaboration_audience?: CommentAudience }> {
  const applied = await resolveThreadAudience(trx, tenant, input.audience);
  let row: CommentThreadRow = {
    tenant,
    thread_id: input.threadId,
    ticket_id: input.ticketId,
    project_task_id: null,
    root_comment_id: input.rootCommentId,
    is_internal: input.isInternal,
    ...applied,
    reply_count: 0,
    last_activity_at: input.at,
    created_at: input.at,
    created_by: input.createdBy,
  };
  const registered = contributors();
  // With nothing registered this is a straight insert: no extra work, no extra query.
  for (const contribute of registered) {
    const extra = await contribute(trx, tenant, row, input.intent);
    if (extra) row = { ...row, ...extra };
  }
  await tenantDb(trx, tenant).table('comment_threads').insert(row);
  return applied;
}
