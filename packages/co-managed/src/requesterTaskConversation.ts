import { createHash } from 'node:crypto';
import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { CoManagedSharedWorkError, isCoManagedUuid, type CoManagedSessionActor } from './sharedWorkIdentity';
import { withRequesterTaskAccess, type RequesterTaskTarget, type RequesterTaskSessionAccess as Access } from './requesterTaskAccess';
export { withRequesterTaskAccess };
export type { RequesterTaskTarget };
import { encodeConversationContent, snapshotConversationContent } from './conversationContent';
import { projectTaskAudienceSql } from './projectTaskAudience';
import { retainCoManagedTaskCommentEvent } from './projectTaskEvents';
import { listPublishedCoManagedAttachments, readPublishedCoManagedAttachment, type CoManagedAttachmentReadContext, type CoManagedConversationAttachment } from './conversationAttachments';

const deny = (): never => { throw new CoManagedSharedWorkError(); };
export interface RequesterTaskReply { operationId: string; text: string; parent?: { threadId: string; commentId: string } }
export interface RequesterTaskConversationItem {
  commentId: string; threadId: string; parentCommentId: string | null; createdAt: string; deleted: boolean; canReply: boolean;
  note: string | null; markdown: string | null; authorName: string | null; organizationName: string | null; attachments: CoManagedConversationAttachment[];
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
      'c.actor_display_name', 'c.actor_organization_name', { root_deleted_at: 'root.deleted_at' },
      context.trx.raw(`to_char(c.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as created_at_exact`));
    const items: RequesterTaskConversationItem[] = [];
    for (const row of rows.slice(0, 25)) {
      const attachmentContext = { trx: context.trx, resource: { tenant: context.actor.tenant, id: context.target.taskId, kind: 'project_task' as const },
        comment: { storeTenant: context.actor.tenant, threadId: row.thread_id, commentId: row.task_comment_id }, audience: 'requester' as const };
      items.push({ commentId: row.task_comment_id as string, threadId: row.thread_id as string, parentCommentId: row.parent_comment_id as string | null,
        createdAt: row.created_at_exact as string, deleted: Boolean(row.deleted_at), canReply: context.canWrite && !row.deleted_at && !row.root_deleted_at,
        note: row.deleted_at ? null : row.note as string, markdown: row.deleted_at ? null : row.markdown_content as string | null,
        authorName: row.actor_display_name as string | null, organizationName: row.actor_organization_name as string | null,
        attachments: row.deleted_at ? [] : await listPublishedCoManagedAttachments(attachmentContext) });
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
    const organization = await own.table('tenants').first('client_name');
    await own.table('project_task_comments').insert({ tenant: actor.tenant, task_comment_id: operationId, task_id: target.taskId, thread_id: threadId,
      parent_comment_id: parent?.commentId ?? null, user_id: actor.userId, author_type: 'client', actor_reference_id: null,
      actor_display_name: [user.first_name, user.last_name].filter(Boolean).join(' ') || user.email,
      actor_organization_name: organization.client_name || actor.tenant, ...encodeConversationContent(content), collaboration_revision: 1, request_hash: hash,
      created_at: trx.raw('clock_timestamp()'), updated_at: trx.raw('clock_timestamp()') });
    if (parent) await own.table('comment_threads').where('thread_id', threadId).update({ reply_count: trx.raw('reply_count + 1'), last_activity_at: trx.raw('clock_timestamp()') });
    await retainCoManagedTaskCommentEvent(trx, { tenant: actor.tenant, eventId: operationId, taskId: target.taskId, commentId: operationId, kind: 'create' });
    return { operationId, commentId: operationId, threadId };
  });
}

export async function downloadRequesterTaskAttachment(db: Knex, actor: CoManagedSessionActor, target: RequesterTaskTarget,
  comment: { threadId: string; commentId: string }, attachmentId: string, download: (path: string) => Promise<Uint8Array>) {
  if (!comment || Object.keys(comment).some(key => !['threadId', 'commentId'].includes(key)) || ![comment.threadId, comment.commentId, attachmentId].every(isCoManagedUuid)) deny();
  const threadId = comment.threadId.toLowerCase(), commentId = comment.commentId.toLowerCase(), id = attachmentId.toLowerCase();
  return withRequesterTaskAccess(db, actor, target, false, async context => {
    if (!await requesterComments(context).where({ 'c.thread_id': threadId, 'c.task_comment_id': commentId }).whereNull('c.deleted_at').forShare('c', 't', 'root').first('c.task_comment_id')) deny();
    const access: CoManagedAttachmentReadContext = { trx: context.trx, audience: 'requester', resource: { tenant: context.actor.tenant, id: context.target.taskId, kind: 'project_task' },
      comment: { storeTenant: context.actor.tenant, threadId, commentId } };
    return readPublishedCoManagedAttachment(access, id, download);
  });
}
