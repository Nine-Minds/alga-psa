import { createHash } from 'node:crypto';
import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { CoManagedSharedWorkError, isCoManagedUuid, type CoManagedSessionActor } from './sharedWorkIdentity';
import { withRequesterTaskAccess, type RequesterTaskTarget, type RequesterTaskSessionAccess as Access } from './requesterTaskAccess';
export { withRequesterTaskAccess };
export type { RequesterTaskTarget };
import { encodeConversationContent, snapshotConversationContent } from './conversationContent';
import { projectTaskAudienceSql } from './projectTaskAudience';

const deny = (): never => { throw new CoManagedSharedWorkError(); };
export interface RequesterTaskReply { operationId: string; text: string; parent?: { threadId: string; commentId: string } }
export interface RequesterTaskConversationItem {
  commentId: string; threadId: string; parentCommentId: string | null; createdAt: string; deleted: boolean; canReply: boolean;
  note: string | null; markdown: string | null; authorName: string | null; organizationName: string | null; authorKind: 'user' | 'contact'; isOwn: boolean;
}
export class RequesterTaskCommentConflict extends Error { constructor() { super('This comment operation was already used.'); } }

function requesterComments(context: Access) {
  const { trx, actor, target } = context, own = tenantDb(trx, actor.tenant);
  const query = own.table('project_task_comments as c').where('c.task_id', target.taskId);
  own.tenantJoin(query, 'comment_threads as t', 'c.thread_id', 't.thread_id', { on: join => join.andOn('t.project_task_id', '=', 'c.task_id').andOnNull('t.ticket_id') });
  own.tenantJoin(query, 'project_task_comments as root', 't.root_comment_id', 'root.task_comment_id', { on: join => join.andOn('root.task_id', '=', 'c.task_id').andOn('root.thread_id', '=', 'c.thread_id') });
  return query.whereRaw('? = ?', [projectTaskAudienceSql(trx, 't'), 'requester']);
}
export async function getRequesterTaskConversation(db: Knex, actor: CoManagedSessionActor, target: RequesterTaskTarget,
  before?: { createdAt: string; commentId: string }) {
  if (before && (Object.keys(before).some(key => !['createdAt', 'commentId'].includes(key)) || !isCoManagedUuid(before.commentId) ||
    typeof before.createdAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/.test(before.createdAt) || !Number.isFinite(Date.parse(before.createdAt)))) deny();
  const cursor = before ? { ...before } : undefined;
  return withRequesterTaskAccess(db, actor, target, false, async context => {
    const query = requesterComments(context).orderBy('c.created_at', 'desc').orderBy('c.task_comment_id', 'desc').limit(26);
    if (cursor) query.whereRaw('(c.created_at, c.task_comment_id) < (?::timestamptz, ?::uuid)', [cursor.createdAt, cursor.commentId]);
    const rows = await query.forShare('c', 't', 'root').select('c.task_comment_id', 'c.thread_id', 'c.parent_comment_id', 'c.note', 'c.markdown_content', 'c.deleted_at',
      'c.actor_display_name', 'c.actor_organization_name', 'c.author_kind', 'c.contact_id', { root_deleted_at: 'root.deleted_at' },
      context.trx.raw(`to_char(c.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as created_at_exact`));
    const items: RequesterTaskConversationItem[] = [];
    for (const row of rows.slice(0, 25)) {
      items.push({ commentId: row.task_comment_id as string, threadId: row.thread_id as string, parentCommentId: row.parent_comment_id as string | null,
        createdAt: row.created_at_exact as string, deleted: Boolean(row.deleted_at), canReply: context.canWrite && !row.deleted_at && !row.root_deleted_at,
        note: row.deleted_at ? null : row.note as string, markdown: row.deleted_at ? null : row.markdown_content as string | null,
        authorName: row.actor_display_name as string | null, organizationName: row.actor_organization_name as string | null,
        // A missing author kind is a row written before contact authorship existed: it is a user.
        authorKind: row.author_kind === 'contact' ? 'contact' : 'user',
        isOwn: row.author_kind === 'contact' && row.contact_id === context.user.contact_id });
    }
    const last = items.at(-1);
    return { target: context.target, actor: { tenant: context.actor.tenant, userId: context.actor.userId }, canWrite: context.canWrite, items,
      nextBefore: rows.length > 25 && last ? { createdAt: last.createdAt, commentId: last.commentId } : null };
  });
}

export async function createRequesterTaskComment(db: Knex, actor: CoManagedSessionActor, target: RequesterTaskTarget, input: RequesterTaskReply) {
  if (!input || Object.keys(input).some(key => !['operationId', 'text', 'parent'].includes(key)) || !isCoManagedUuid(input.operationId)) deny();
  const content = snapshotConversationContent({ text: input.text });
  if (input.parent && (Object.keys(input.parent).some(key => !['threadId', 'commentId'].includes(key)) || ![input.parent.threadId, input.parent.commentId].every(isCoManagedUuid))) deny();
  const operationId = input.operationId.toLowerCase(), parent = input.parent ? { threadId: input.parent.threadId.toLowerCase(), commentId: input.parent.commentId.toLowerCase() } : undefined;
  return withRequesterTaskAccess(db, actor, target, true, async context => {
    const { trx, actor, target, user } = context, own = tenantDb(trx, actor.tenant);
    const hash = createHash('sha256').update(JSON.stringify({ tenant: actor.tenant, userId: actor.userId, target, operationId, content, parent })).digest('hex');
    const previous = await own.table('project_task_comments').where('task_comment_id', operationId).forShare().first('request_hash', 'thread_id');
    if (previous) { if (previous.request_hash !== hash) throw new RequesterTaskCommentConflict(); return { operationId, commentId: operationId, threadId: previous.thread_id as string }; }
    if (parent && !await requesterComments(context).where({ 'c.thread_id': parent.threadId, 'c.task_comment_id': parent.commentId })
      .whereNull('c.deleted_at').whereNull('root.deleted_at').forShare('c', 't', 'root').first('c.task_comment_id')) deny();
    const threadId = parent?.threadId ?? operationId;
    if (!parent) await own.table('comment_threads').insert({ tenant: actor.tenant, thread_id: threadId, ticket_id: null, project_task_id: target.taskId,
      root_comment_id: operationId, is_internal: false, collaboration_audience: 'requester', created_by: actor.userId,
      created_at: trx.raw('clock_timestamp()'), last_activity_at: trx.raw('clock_timestamp()'), reply_count: 0 });
    // The requester is a CONTACT: the row carries contact_id and no user_id, so a portal login can never be
    // mistaken for (or promoted to) an internal author.
    const contact = await own.table('contacts').where('contact_name_id', user.contact_id).forShare().first('full_name', 'email', 'client_id');
    const client = contact?.client_id ? await own.table('clients').where('client_id', contact.client_id).forShare().first('client_name') : null;
    const displayName = contact?.full_name || [user.first_name, user.last_name].filter(Boolean).join(' ') || contact?.email || user.email;
    if (!displayName) deny();
    await own.table('project_task_comments').insert({ tenant: actor.tenant, task_comment_id: operationId, task_id: target.taskId, thread_id: threadId,
      parent_comment_id: parent?.commentId ?? null, user_id: null, contact_id: user.contact_id, author_kind: 'contact', author_type: 'client', actor_reference_id: null,
      actor_display_name: displayName, actor_organization_name: client?.client_name ?? null, ...encodeConversationContent(content), collaboration_revision: 1, request_hash: hash,
      created_at: trx.raw('clock_timestamp()'), updated_at: trx.raw('clock_timestamp()') });
    if (parent) await own.table('comment_threads').where('thread_id', threadId).update({ reply_count: trx.raw('reply_count + 1'), last_activity_at: trx.raw('now()') });
    // LEVERAGE: friction task-comment-outbox — no retained event: L4a's outbox is absent, and requester task threads send no mail by design.
    return { operationId, commentId: operationId, threadId };
  });
}
