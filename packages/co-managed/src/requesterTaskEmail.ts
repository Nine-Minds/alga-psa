import type { Knex } from 'knex';
import { tenantDb, withTransaction } from '@alga-psa/db';
import { CoManagedSharedWorkError, isCoManagedUuid } from './sharedWorkIdentity';
import { withRequesterTaskRecipientAccess, type RequesterTaskRecipientAccess } from './requesterTaskAccess';
import { projectTaskAudienceSql } from './projectTaskAudience';
import { coManagedCommentEmailSettings } from './commentEmailRecipient';
import type { CoManagedConversationAuthor } from './ticketConversation';

export interface CoManagedRequesterTaskEmailRecipient {
  kind: 'requester_task_user'; tenant: string; clientId: string; userId: string; contactId: string;
}
export interface CoManagedRequesterTaskCommentEmail {
  resource: { tenant: string; kind: 'project_task'; id: string };
  projectId: string; commentId: string; threadId: string; audience: 'requester'; note: string;
  taskName: string; projectName: string; author?: CoManagedConversationAuthor;
}
export interface CoManagedRequesterTaskEmailDelivery {
  tenant: string; recipient: CoManagedRequesterTaskEmailRecipient; email: string; subtypeId?: number;
  messageId: string; message: CoManagedRequesterTaskCommentEmail;
}
const TABLE = 'co_management_requester_email_deliveries';

async function content(trx: Knex.Transaction, tenant: string, taskId: string, commentId: string, threadId?: string) {
  const own = tenantDb(trx, tenant), query = own.table('project_task_comments as c').where({ 'c.task_id': taskId, 'c.task_comment_id': commentId });
  own.tenantJoin(query, 'comment_threads as t', 'c.thread_id', 't.thread_id', { on: join => join.andOn('t.project_task_id', '=', 'c.task_id').andOnNull('t.ticket_id') });
  own.tenantJoin(query, 'project_task_comments as root', 't.root_comment_id', 'root.task_comment_id', { on: join => join.andOn('root.task_id', '=', 'c.task_id').andOn('root.thread_id', '=', 'c.thread_id') });
  if (threadId) query.where('c.thread_id', threadId);
  return query.whereNull('c.deleted_at').whereNull('root.deleted_at').whereRaw('? = ?', [projectTaskAudienceSql(trx, 't'), 'requester'])
    .forShare('c', 't', 'root').first('c.*');
}
async function belongsToAudience(context: RequesterTaskRecipientAccess, project: any, threadId: string): Promise<boolean> {
  if (project.contact_name_id === context.user.contact_id) return true;
  return Boolean(await tenantDb(context.trx, context.actor.tenant).table('project_task_comments').where({ task_id: context.target.taskId,
    thread_id: threadId, author_type: 'client', user_id: context.actor.userId }).whereNull('deleted_at').forShare().first('task_comment_id'));
}

/** Every send retains current portal role/contact/project/task and public root
 * locks. A historical candidate cannot borrow another requester's current access. */
export async function withCoManagedRequesterTaskCommentEmail<T>(db: Knex, input: CoManagedRequesterTaskEmailRecipient,
  target: { projectId: string; taskId: string }, commentId: string, threadId: string,
  consume: (context: RequesterTaskRecipientAccess, message: CoManagedRequesterTaskCommentEmail, email: string, subtypeId?: number) => Promise<T>): Promise<T | null> {
  if (!input || input.kind !== 'requester_task_user' || ![input.tenant, input.userId, input.clientId, input.contactId, target?.projectId, target?.taskId, commentId, threadId].every(isCoManagedUuid)) throw new CoManagedSharedWorkError();
  const recipient = { ...input }, source = { ...target };
  try { return await withRequesterTaskRecipientAccess(db, { kind: 'requester_task_recipient', tenant: recipient.tenant, userId: recipient.userId }, source, async context => {
    const own = tenantDb(context.trx, context.actor.tenant);
    if (context.user.contact_id !== recipient.contactId) return null;
    const project = await own.table('projects').where({ project_id: source.projectId, client_id: recipient.clientId }).first('project_name', 'contact_name_id');
    if (!project) return null;
    const comment = await content(context.trx, recipient.tenant, source.taskId, commentId, threadId);
    if (!comment || (!comment.actor_reference_id && comment.user_id === recipient.userId) || !await belongsToAudience(context, project, threadId)) return null;
    const settings = await coManagedCommentEmailSettings(context.trx, recipient.tenant, 'Task Comment Added');
    if (!settings || (settings.subtypeId !== undefined && (await own.table('user_notification_preferences').where({ user_id: recipient.userId,
      subtype_id: settings.subtypeId }).forShare().first('is_enabled'))?.is_enabled === false)) return null;
    const email = context.user.email?.trim(); if (typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
    const task = await own.table('project_tasks').where('task_id', source.taskId).first('task_name');
    let author: CoManagedConversationAuthor | undefined;
    if (comment.actor_reference_id) {
      const ref = await own.table('collaboration_actor_references').where('actor_reference_id', comment.actor_reference_id).forShare().first();
      if (!ref || comment.user_id || !comment.actor_display_name || !comment.actor_organization_name) return null;
      author = { tenant: ref.actor_tenant, kind: 'user', id: ref.actor_user_id, referenceId: comment.actor_reference_id,
        displayName: comment.actor_display_name, organizationName: comment.actor_organization_name };
    } else if (comment.user_id) {
      // Retained display snapshots remain useful when an author later leaves.
      const user = await own.table('users').where('user_id', comment.user_id).first('first_name', 'last_name');
      author = { tenant: recipient.tenant, kind: 'user', id: comment.user_id, referenceId: null,
        displayName: comment.actor_display_name ?? [user?.first_name, user?.last_name].filter(Boolean).join(' '), organizationName: comment.actor_organization_name ?? null };
    }
    return consume(context, { resource: { tenant: recipient.tenant, kind: 'project_task', id: source.taskId }, projectId: source.projectId,
      commentId, threadId, audience: 'requester', note: comment.note ?? '', taskName: task?.task_name ?? '', projectName: project.project_name, author }, email, settings.subtypeId);
  }); } catch (error) { if (error instanceof CoManagedSharedWorkError) return null; throw error; }
}

/** Candidates are the project's designated portal contact and requester
 * participants in this public thread. Never fan out to every client user or a
 * generic company mailbox. Consumer completion makes this discovery durable. */
export async function enqueueCoManagedRequesterTaskEmailDeliveries(db: Knex, input: { ownerTenant: string; taskId: string; commentId: string; eventId: string }) {
  if (!input || ![input.ownerTenant, input.taskId, input.commentId, input.eventId].every(isCoManagedUuid)) throw new CoManagedSharedWorkError();
  const request = Object.fromEntries(Object.entries(input).map(([key, value]) => [key, value.toLowerCase()])) as typeof input;
  return withTransaction(db, async trx => {
    const own = tenantDb(trx, request.ownerTenant);
    const existing = await own.table(TABLE).where({ event_id: request.eventId, resource_type: 'project_task' }).forShare();
    if (existing.length) {
      if (existing.some(row => row.resource_id !== request.taskId || row.comment_id !== request.commentId)) throw new Error('Requester task email source identity conflict');
      return;
    }
    const source = own.table('project_tasks as task').where('task.task_id', request.taskId);
    own.tenantJoin(source, 'project_phases as phase', 'task.phase_id', 'phase.phase_id');
    own.tenantJoin(source, 'projects as project', 'phase.project_id', 'project.project_id');
    const project = await source.first('project.project_id', 'project.client_id', 'project.contact_name_id'); if (!project) return;
    const comment = await content(trx, request.ownerTenant, request.taskId, request.commentId); if (!comment) return;
    const participants = own.table('project_task_comments').where({ task_id: request.taskId, thread_id: comment.thread_id, author_type: 'client' }).whereNull('deleted_at').whereNotNull('user_id').select('user_id');
    const candidates = await own.table('users').where({ user_type: 'client', is_inactive: false }).where(query => {
      query.whereIn('user_id', participants); if (project.contact_name_id) query.orWhere('contact_id', project.contact_name_id);
    }).orderBy('user_id').select('user_id', 'contact_id');
    for (const user of candidates) {
      if (!user.contact_id) continue;
      const recipient: CoManagedRequesterTaskEmailRecipient = { kind: 'requester_task_user', tenant: request.ownerTenant, clientId: project.client_id, userId: user.user_id, contactId: user.contact_id };
      await withCoManagedRequesterTaskCommentEmail(trx, recipient, { projectId: project.project_id, taskId: request.taskId }, request.commentId, comment.thread_id, async (_context, message) => {
        const row = { tenant: request.ownerTenant, delivery_key: `co-managed-requester-task:${request.ownerTenant}:${request.taskId}:${request.commentId}:${request.eventId}:${user.user_id}:email`,
          resource_type: 'project_task', resource_id: request.taskId, project_id: project.project_id, ticket_id: null, contact_id: user.contact_id,
          recipient_kind: 'requester_task_user', recipient_id: user.user_id, client_id: project.client_id,
          event_id: request.eventId, comment_id: request.commentId, thread_id: message.threadId };
        await own.table(TABLE).insert(row).onConflict(['tenant', 'delivery_key']).ignore();
        const saved = await own.table(TABLE).where('delivery_key', row.delivery_key).forShare().first();
        if (!saved || Object.entries(row).some(([key, value]) => saved[key] !== value)) throw new Error('Requester task email identity conflict');
      });
    }
  });
}
