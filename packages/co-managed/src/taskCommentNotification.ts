import type { Knex } from 'knex';
import { tenantDb, withTransaction } from '@alga-psa/db';
import { withCoManagedSharedWork, withCoManagedNotificationRecipient, type CoManagedSharedResource, type CoManagedNotificationRecipient, type CoManagedNotificationRecipientContext } from './sharedWork';
import { CoManagedSharedWorkError, isCoManagedUuid, snapshotCoManagedSessionActor, lockCoManagedSessionIdentity, lockCoManagedRecipientIdentity,
  authorizeCoManagedWorkRecord, assertCoManagedSessionUnexpired, type CoManagedSessionActor } from './sharedWorkIdentity';
import { isCoManagedReadFieldHidden } from './sharedWorkRedaction';
import { coManagedConversationBodySources, coManagedConversationAuthorSources } from './conversationPolicy';
import { projectTaskAudienceSql } from './projectTaskAudience';
import type { CoManagedConversationAuthor } from './ticketConversation';
import type { TicketCommentAudience } from './ticketCommentNotificationContent';

export interface CoManagedTaskCommentNotification {
  resource: CoManagedSharedResource; commentId: string; threadId: string; audience: TicketCommentAudience; note: string;
  taskName?: string; projectName?: string; author?: CoManagedConversationAuthor;
  /** Owner navigation remains valid after separation; only current parent IDs are used. */
  ownerTaskPath?: string;
}
type Actor = CoManagedSessionActor | CoManagedNotificationRecipient;

/** Current recipient authority, retained through the callback. Customer-local
 * history is owned independently of live MSP trust; MSP reads retain that trust. */
export async function withCoManagedTaskCommentNotification<T>(db: Knex, input: Actor, target: CoManagedSharedResource, inputCommentId: string,
  deliver: (context: CoManagedNotificationRecipientContext, message: CoManagedTaskCommentNotification) => Promise<T>): Promise<T | null> {
  if (!input || !['session', 'notification_recipient'].includes(input.kind) || !target || target.kind !== 'project_task' ||
    ![input.tenant, input.userId, target.tenant, target.id, target.relationshipId, inputCommentId].every(isCoManagedUuid)) throw new CoManagedSharedWorkError();
  const actor: Actor = input.kind === 'session' ? snapshotCoManagedSessionActor(input) : { kind: 'notification_recipient', tenant: input.tenant, userId: input.userId };
  actor.tenant = actor.tenant.toLowerCase(); actor.userId = actor.userId.toLowerCase();
  if (actor.kind === 'session') actor.sessionId = actor.sessionId.toLowerCase();
  const resource = { kind: target.kind, tenant: target.tenant.toLowerCase(), relationshipId: target.relationshipId.toLowerCase(), id: target.id.toLowerCase() }, commentId = inputCommentId.toLowerCase();
  const load = async (context: CoManagedNotificationRecipientContext) => {
    const message = await readTaskContent(context, commentId);
    if (!message) return null;
    if (actor.kind === 'session') await assertCoManagedSessionUnexpired(context.trx, actor);
    const result = await deliver(context, message);
    if (actor.kind === 'session') await assertCoManagedSessionUnexpired(context.trx, actor);
    return result;
  };
  if (actor.tenant !== resource.tenant) return actor.kind === 'session'
    ? withCoManagedSharedWork(db, actor, resource, 'read', context => load({ ...context, action: 'read' }))
    : withCoManagedNotificationRecipient(db, actor, resource, load);
  return withTransaction(db, async trx => {
    const owner = tenantDb(trx, actor.tenant);
    const relationship = await owner.table('co_management_relationships').where('relationship_id', resource.relationshipId).forShare().first('revision');
    const workspace = await owner.table('tenants').forShare().first('product_code', 'suspended_at');
    if (!relationship || !workspace || !['co_managed', 'psa'].includes(workspace.product_code) || workspace.suspended_at) throw new CoManagedSharedWorkError();
    const subject = actor.kind === 'session' ? await lockCoManagedSessionIdentity(trx, actor) : await lockCoManagedRecipientIdentity(trx, actor);
    const locate = owner.table('project_tasks as task').where('task.task_id', resource.id);
    owner.tenantJoin(locate, 'project_phases as phase', 'task.phase_id', 'phase.phase_id');
    const initial = await locate.clone().first('phase.project_id'); if (!initial) throw new CoManagedSharedWorkError();
    const project = await owner.table('projects').where('project_id', initial.project_id).forShare().first('project_id', 'client_id', 'assigned_to');
    const confirmed = await locate.clone().forShare('task', 'phase').first('phase.project_id');
    if (!project || confirmed?.project_id !== project.project_id) throw new CoManagedSharedWorkError();
    // LEVERAGE: pattern customer-project-policy-record — recipient reads and interactive work use the actual parent project.
    const decision = await authorizeCoManagedWorkRecord(trx, actor, subject, 'project', 'read', { id: project.project_id, clientId: project.client_id,
      assignedUserIds: project.assigned_to ? [project.assigned_to] : [], teamIds: [] });
    return load({ trx, actor: { tenant: actor.tenant, userId: actor.userId }, resource, revision: relationship.revision, action: 'read', redactedFields: decision.redactedFields });
  });
}

async function readTaskContent(context: CoManagedNotificationRecipientContext, commentId: string): Promise<CoManagedTaskCommentNotification | null> {
  const { trx, actor, resource, redactedFields } = context, owner = tenantDb(trx, resource.tenant);
  const hidden = (fields: readonly string[]) => isCoManagedReadFieldHidden(redactedFields, fields);
  if (hidden([...coManagedConversationBodySources, 'project_task_comments', 'comment_threads', 'task_comment_id', 'task_id'])) return null;
  const locator = await owner.table('project_task_comments').where({ task_comment_id: commentId, task_id: resource.id }).first('thread_id');
  if (!locator?.thread_id) return null;
  const thread = await owner.table('comment_threads').where({ thread_id: locator.thread_id, project_task_id: resource.id }).whereNull('ticket_id').forShare().first();
  if (!thread) return null;
  const query = owner.table('project_task_comments as c').where({ 'c.task_comment_id': commentId, 'c.task_id': resource.id, 'c.thread_id': thread.thread_id }).whereNull('c.deleted_at');
  owner.tenantJoin(query, 'comment_threads as t', 'c.thread_id', 't.thread_id');
  owner.tenantJoin(query, 'project_task_comments as root', 't.root_comment_id', 'root.task_comment_id', { on: join => join.andOn('root.thread_id', '=', 'c.thread_id').andOn('root.task_id', '=', 'c.task_id') });
  const comment = await query.select('c.*', { audience: projectTaskAudienceSql(trx, 't') }).forShare().first();
  if (!comment || (actor.tenant !== resource.tenant && comment.audience === 'organization_private')) return null;
  let author: CoManagedConversationAuthor;
  if (comment.actor_reference_id) {
    const reference = await owner.table('collaboration_actor_references').where('actor_reference_id', comment.actor_reference_id).forShare().first();
    if (!reference || comment.user_id || !comment.actor_display_name || !comment.actor_organization_name) return null;
    author = { tenant: reference.actor_tenant, kind: 'user', id: reference.actor_user_id, referenceId: comment.actor_reference_id,
      displayName: comment.actor_display_name, organizationName: comment.actor_organization_name };
  } else {
    const user = await owner.table('users').where('user_id', comment.user_id).forShare().first('first_name', 'last_name');
    if (!user) return null;
    const organization = await owner.table('tenants').first('client_name');
    author = { tenant: resource.tenant, kind: 'user', id: comment.user_id, referenceId: null,
      displayName: comment.actor_display_name ?? [user.first_name, user.last_name].filter(Boolean).join(' '), organizationName: comment.actor_organization_name ?? organization?.client_name ?? null };
  }
  if (author.tenant === actor.tenant && author.id === actor.userId) return null;
  const taskQuery = owner.table('project_tasks as task').where('task.task_id', resource.id);
  owner.tenantJoin(taskQuery, 'project_phases as phase', 'task.phase_id', 'phase.phase_id');
  owner.tenantJoin(taskQuery, 'projects as p', 'phase.project_id', 'p.project_id');
  const task = await taskQuery.first('task.task_name', 'task.phase_id', 'p.project_id', 'p.project_name'); if (!task) return null;
  if (actor.tenant === resource.tenant && hidden(['project_id', 'projectId', 'phase_id', 'phaseId', 'project', 'phase', 'projects', 'project_phases'])) return null;
  return { resource, commentId, threadId: thread.thread_id, audience: comment.audience, note: comment.note ?? '',
    ...(actor.tenant === resource.tenant ? { ownerTaskPath: `/msp/projects/${task.project_id}?phaseId=${task.phase_id}&taskId=${resource.id}` } : {}),
    ...(hidden(['task_name', 'values.task_name', 'project_tasks.task_name']) ? {} : { taskName: task.task_name }),
    ...(hidden(['project', 'projectName', 'project_id', 'project_name', 'projects']) ? {} : { projectName: task.project_name }),
    ...(hidden(coManagedConversationAuthorSources) ? {} : { author }) };
}
