/**
 * Project task comments and reactions — the one implementation behind both
 * the web server actions (projectTaskCommentActions / ...ReactionActions) and
 * the REST API (ApiProjectTaskCommentController). Keeping a single writer here
 * means a comment added from the mobile app publishes the same events, and so
 * fires the same mention and assignee notifications, as one added on the web.
 *
 * Callers own authentication and tenant context; every function takes the
 * connection, tenant and acting user explicitly. Failures are thrown as plain
 * Errors with the messages the action-layer mapper already understands.
 *
 * Every function runs inside withTaskCommentAccess, so co-managed admission
 * (shared tasks, organization-private audiences, hidden fields) applies to the
 * REST API exactly as to the web. Events publish only after the owning
 * transaction commits.
 */

import { tenantDb, registerAfterCommit, registerAfterCommitWithConnection } from '@alga-psa/db';
import { randomUUID } from 'node:crypto';
import { assertCoManagedOperationalWrite } from '@alga-psa/licensing';
import { hasCoManagedConversationOwnership } from '@alga-psa/co-managed/nativeConversationEvents';
import { CoManagedSharedWorkError, projectTaskAudienceSql, retainCoManagedTaskCommentEvent, dispatchCoManagedConversationEvents } from '@alga-psa/co-managed';
import { convertBlockNoteToMarkdown } from '@alga-psa/formatting/blocknoteUtils';
import { getEntityImageUrlsBatch } from '@alga-psa/formatting/avatarUtils';
import { publishEvent, publishStoredEvent, publishWorkflowEvent } from '@alga-psa/event-bus/publishers';
import { buildTaskCommentAddedPayload, buildTaskCommentUpdatedPayload } from '@alga-psa/workflow-streams';
import { aggregateReactions, validateEmoji } from '@alga-psa/types';
import type { IAggregatedReaction, IProjectTaskComment, IProjectTaskCommentWithUser, IReactionsBatchResult } from '@alga-psa/types';
import type { Knex } from 'knex';
import { assertNativeTaskNote, withTaskCommentAccess } from '../taskCommentAccess';
import {
  BuiltinAuthorizationKernelProvider,
  RequestLocalAuthorizationCache,
  createAuthorizationKernel,
} from '@alga-psa/authorization/kernel';

export type TaskCommentActor = { user_id: string; user_type: 'internal' | 'client' };

export type CreateTaskCommentInput = {
  taskId: string;
  note: string;
  parentCommentId?: string | null;
};

const RETAINED_COMMENT_EVENT_KINDS: Record<string, 'create' | 'edit' | 'delete' | undefined> = {
  PROJECT_TASK_COMMENT_CREATED: 'create',
  PROJECT_TASK_COMMENT_UPDATED: 'edit',
  PROJECT_TASK_COMMENT_DELETED: 'delete',
};

/**
 * Publish a comment event after the owning transaction commits. Where the
 * tenant's task conversations are co-managed, PROJECT_TASK_COMMENT_* is
 * retained with the mutation and delivered through the conversation
 * dispatcher instead, so a mirror never misses it.
 */
async function publishCommentEventAfterCommit(
  trx: Knex.Transaction,
  eventType: string,
  source: { tenantId: string; taskId: string; taskCommentId: string },
  publish: () => Promise<unknown>,
): Promise<void> {
  const kind = RETAINED_COMMENT_EVENT_KINDS[eventType];
  if (kind && await hasCoManagedConversationOwnership(trx, source.tenantId)) {
    const eventId = randomUUID();
    await retainCoManagedTaskCommentEvent(trx, { tenant: source.tenantId, eventId, taskId: source.taskId, commentId: source.taskCommentId, kind });
    registerAfterCommitWithConnection(trx, root => dispatchCoManagedConversationEvents(root, source.tenantId,
      (publication, id) => publishStoredEvent({ eventType: publication.eventType, payload: publication.payload }, { eventId: id, strict: true }), { eventId }).then(() => {}),
      'native task conversation delivery');
    return;
  }
  registerAfterCommit(trx, async () => { await publish(); }, eventType);
}

/** A stored comment row as the database returns it. */
export type TaskCommentRow = {
  task_comment_id: string;
  task_id: string;
  thread_id: string | null;
  parent_comment_id: string | null;
  user_id: string;
  author_type: 'internal';
  note: string;
  markdown_content: string;
  created_at: string;
  updated_at?: string | null;
  edited_at?: string | null;
  deleted_at?: string | null;
  tenant: string;
};

export type TaskCommentReactionsBatch = IReactionsBatchResult;

function tenantScopedTable(
  conn: Knex | Knex.Transaction,
  table: string,
  tenant: string,
): Knex.QueryBuilder {
  return tenantDb(conn, tenant).table(table);
}

function buildCommentAuthorizationSubject(user: TaskCommentActor, tenant: string) {
  return {
    tenant,
    userId: user.user_id,
    userType: user.user_type,
    roleIds: [],
    teamIds: [],
    managedUserIds: [],
    portfolioClientIds: [],
    clientId: null,
  };
}

async function assertOwnCommentOrInternalUser(
  trx: Knex.Transaction,
  user: TaskCommentActor,
  tenant: string,
  taskCommentId: string,
  ownerUserId: string,
  action: 'update' | 'delete'
): Promise<void> {
  if (user.user_type === 'internal') {
    return;
  }

  const kernel = createAuthorizationKernel({
    builtinProvider: new BuiltinAuthorizationKernelProvider({
      relationshipRules: [{ template: 'own' }],
    }),
    rbacEvaluator: async () => true,
  });

  const decision = await kernel.authorizeResource({
    subject: buildCommentAuthorizationSubject(user, tenant),
    resource: {
      type: 'project_task_comment',
      action,
      id: taskCommentId,
    },
    record: {
      id: taskCommentId,
      ownerUserId,
    },
    requestCache: new RequestLocalAuthorizationCache(),
    knex: trx,
  });

  if (!decision.allowed) {
    const verb = action === 'update' ? 'edit' : 'delete';
    throw new Error(`You can only ${verb} your own comments`);
  }
}

async function loadTaskContext(
  trx: Knex | Knex.Transaction,
  tenant: string,
  taskId: string,
): Promise<{ project_id: string; task_name: string }> {
  const taskQuery = tenantScopedTable(trx, 'project_tasks', tenant);
  tenantDb(trx, tenant).tenantJoin(taskQuery, 'project_phases', 'project_tasks.phase_id', 'project_phases.phase_id');
  const task = await taskQuery
    .where('project_tasks.task_id', taskId)
    .select('project_phases.project_id', 'project_tasks.task_name')
    .first();

  if (!task) {
    throw new Error('Task not found');
  }
  return task;
}

/** True when the task exists in this tenant; the REST layer answers 404 otherwise. */
export async function taskExists(trx: Knex | Knex.Transaction, tenant: string, taskId: string): Promise<boolean> {
  const row = await tenantScopedTable(trx, 'project_tasks', tenant)
    .where({ task_id: taskId })
    .select('task_id')
    .first();
  return Boolean(row);
}

export async function getTaskCommentById(
  trx: Knex | Knex.Transaction,
  tenant: string,
  taskCommentId: string,
): Promise<TaskCommentRow | null> {
  const row = await tenantScopedTable(trx, 'project_task_comments', tenant)
    .where({ task_comment_id: taskCommentId })
    .first();
  return (row as TaskCommentRow | undefined) ?? null;
}


/**
 * Insert a comment or a reply, keep the thread row current, and publish the
 * TASK_COMMENT_ADDED / PROJECT_TASK_COMMENT_CREATED events the notification
 * subscribers listen for. Returns the new comment id.
 */
export async function createTaskCommentWithDb(
  db: Knex,
  tenant: string,
  user: TaskCommentActor,
  input: CreateTaskCommentInput,
): Promise<string> {
  if (typeof input?.taskId !== 'string' || typeof input?.note !== 'string') throw new Error('Invalid task comment');
  const comment = { ...input, taskId: input.taskId.toLowerCase() };

  return withTaskCommentAccess(db, user, tenant, { taskIds: [comment.taskId] }, 'update', async ({ trx, collaboration }) => {
    await assertCoManagedOperationalWrite(trx, tenant);
    const userId = user.user_id;

    // Verify user is internal
    const userRecord = await tenantScopedTable(trx, 'users', tenant)
      .where({ user_id: userId })
      .first();

    if (!userRecord || userRecord.user_type !== 'internal') {
      throw new Error('Only internal users can comment on tasks');
    }

    // Convert BlockNote to markdown
    const markdownContent = convertBlockNoteToMarkdown(comment.note);

    // Get project context for notifications and validate task before inserting thread/comment rows
    const task = await loadTaskContext(trx, tenant, comment.taskId);

    const now = new Date().toISOString();
    const parentCommentId = comment.parentCommentId || null;
    const isReply = Boolean(parentCommentId);
    let taskCommentId: string | undefined;
    let threadId: string | undefined;

    if (isReply) {
      const parent = await tenantScopedTable(trx, 'project_task_comments', tenant)
        .select('task_comment_id', 'task_id', 'thread_id', 'deleted_at', 'actor_reference_id', 'user_id', 'collaboration_revision')
        .where({ task_comment_id: parentCommentId })
        .first();

      if (!parent) {
        throw new Error('Parent task comment not found');
      }

      if (parent.task_id !== comment.taskId) {
        throw new Error('Parent task comment must belong to the same task');
      }

      if (parent.deleted_at) {
        throw new Error('Cannot reply to a deleted task comment');
      }

      await assertNativeTaskNote(trx, tenant, parent, collaboration, { reply: true });
      const idsResult = await trx.raw('SELECT gen_random_uuid() AS task_comment_id');
      taskCommentId = idsResult.rows?.[0]?.task_comment_id;
      threadId = parent.thread_id;
    } else {
      const idsResult = await trx.raw('SELECT gen_random_uuid() AS task_comment_id, gen_random_uuid() AS thread_id');
      const generatedIds = idsResult.rows?.[0];
      taskCommentId = generatedIds?.task_comment_id;
      threadId = generatedIds?.thread_id;

      await tenantScopedTable(trx, 'comment_threads', tenant).insert({
        tenant,
        thread_id: threadId,
        ticket_id: null,
        project_task_id: comment.taskId,
        root_comment_id: taskCommentId,
        is_internal: Boolean(collaboration),
        ...(collaboration ? { collaboration_audience: 'organization_private' } : {}),
        reply_count: 0,
        last_activity_at: now,
        created_at: now,
        created_by: userId,
      });
    }

    if (!taskCommentId || !threadId) {
      throw new Error('Database UUID generation did not return task comment/thread identifiers.');
    }

    const organization = collaboration ? await tenantScopedTable(trx, 'tenants', tenant).first('client_name') : null;
    // Insert comment (convert camelCase to snake_case for DB)
    const [newComment] = await tenantScopedTable(trx, 'project_task_comments', tenant)
      .insert({
        task_comment_id: taskCommentId,
        task_id: comment.taskId,
        thread_id: threadId,
        parent_comment_id: parentCommentId,
        user_id: userId,
        tenant,
        author_type: 'internal',
        ...(collaboration ? {
          actor_display_name: [userRecord.first_name, userRecord.last_name].filter(Boolean).join(' ') || userRecord.email || userId,
          actor_organization_name: organization?.client_name || tenant,
        } : {}),
        note: comment.note,
        markdown_content: markdownContent,
        created_at: now
      })
      .returning('*');

    if (isReply) {
      await tenantScopedTable(trx, 'comment_threads', tenant)
        .where({ thread_id: threadId })
        .update({
          reply_count: trx.raw('reply_count + 1'),
          last_activity_at: now,
        });
    }

    const source = { tenantId: tenant, taskId: comment.taskId, taskCommentId: newComment.task_comment_id };
    // Mention extraction happens in the event handler.
    await publishCommentEventAfterCommit(trx, 'TASK_COMMENT_ADDED', source, () => publishWorkflowEvent({
      eventType: 'TASK_COMMENT_ADDED',
      payload: buildTaskCommentAddedPayload({
        taskId: comment.taskId,
        projectId: task.project_id,
        createdByUserId: userId,
        taskCommentId: newComment.task_comment_id,
        threadId,
        parentCommentId,
        isReply,
        taskName: task.task_name,
        commentContent: comment.note,  // BlockNote JSON with embedded mentions
      }),
      ctx: {
        tenantId: tenant,
        actor: { actorType: 'USER', actorUserId: userId },
      },
    }));

    await publishCommentEventAfterCommit(trx, 'PROJECT_TASK_COMMENT_CREATED', source, () => publishEvent({
      eventType: 'PROJECT_TASK_COMMENT_CREATED',
      payload: {
        tenantId: tenant,
        taskId: comment.taskId,
        projectId: task.project_id,
        userId,
        taskCommentId: newComment.task_comment_id,
        taskName: task.task_name,
        commentContent: comment.note,
        isUpdate: false
      }
    }));

    return newComment.task_comment_id;
  });
}

/**
 * Every comment on a task the actor may see, oldest first, with the author
 * joined and avatars resolved. Co-managed fields hidden from this viewer
 * (author, revision, reactions) are blanked.
 */
export async function listTaskCommentsWithDb(
  db: Knex,
  tenant: string,
  user: TaskCommentActor,
  taskId: string,
): Promise<IProjectTaskCommentWithUser[]> {
  return withTaskCommentAccess(db, user, tenant, { taskIds: [taskId] }, 'read', async ({ trx, collaboration }) => {
    const owner = tenantDb(trx, tenant);
    const commentsQuery = tenantScopedTable(trx, 'project_task_comments', tenant);
    tenantDb(trx, tenant).tenantJoin(commentsQuery, 'users', 'project_task_comments.user_id', 'users.user_id', { type: 'left' });
    owner.tenantJoin(commentsQuery, 'comment_threads as thread', 'project_task_comments.thread_id', 'thread.thread_id', { type: 'left', on: join => join.andOn('thread.project_task_id', '=', 'project_task_comments.task_id').andOnNull('thread.ticket_id') });
    owner.tenantJoin(commentsQuery, 'project_task_comments as root', 'thread.root_comment_id', 'root.task_comment_id', { type: 'left', on: join => join.andOn('root.task_id', '=', 'project_task_comments.task_id').andOn('root.thread_id', '=', 'thread.thread_id') });
    const comments = await commentsQuery
      .where({ 'project_task_comments.task_id': taskId })
      .select(
        'project_task_comments.*',
        'users.first_name',
        'users.last_name',
        'users.email', 'root.deleted_at as root_deleted_at',
        { audience: projectTaskAudienceSql(trx, 'thread') }
      )
      .orderBy('project_task_comments.created_at', 'asc') as any[];

    const authorHidden = collaboration?.hidden(taskId, ['author']) ?? false;
    const revisionHidden = collaboration?.hidden(taskId, ['revision', 'collaboration_revision']) ?? false;
    // Get avatar URLs for visible local users only
    const userIds: string[] = [
      ...new Set(
        comments
          .map((c: any) => authorHidden ? null : c.user_id)
          .filter((id): id is string => typeof id === 'string' && id.length > 0)
      ),
    ];
    const avatarUrls = tenant ? await getEntityImageUrlsBatch('user', userIds, tenant) : new Map<string, string | null>();

    // Map snake_case to camelCase
    return comments.map((comment: any) => ({
      taskCommentId: comment.task_comment_id,
      taskId: comment.task_id,
      threadId: comment.thread_id,
      parentCommentId: comment.parent_comment_id,
      userId: authorHidden ? null : comment.user_id,
      authorType: comment.author_type,
      // A soft-deleted comment already stores its tombstone body; blanking it here
      // would drop the "[deleted]" marker the thread renders in place of the comment.
      note: comment.note,
      markdownContent: comment.markdown_content,
      createdAt: comment.created_at,
      updatedAt: comment.updated_at,
      editedAt: comment.edited_at,
      deletedAt: comment.deleted_at,
      tenant: comment.tenant,
      firstName: authorHidden ? '' : comment.actor_display_name || comment.first_name || '',
      lastName: authorHidden || comment.actor_display_name ? '' : comment.last_name || '',
      email: authorHidden || comment.actor_reference_id ? '' : comment.email || '',
      organizationName: authorHidden ? undefined : comment.actor_organization_name || undefined,
      audience: collaboration ? comment.audience : undefined,
      collaborationRevision: revisionHidden ? undefined : comment.collaboration_revision,
      canEdit: !comment.deleted_at && !authorHidden && !revisionHidden && comment.user_id === user.user_id && (!collaboration || comment.audience === 'organization_private'),
      canReply: !comment.deleted_at && !comment.root_deleted_at && (!collaboration || comment.audience === 'organization_private'),
      canReact: !comment.deleted_at && !(collaboration?.hidden(taskId, ['author', 'reactions', 'project_task_comment_reactions']) ?? false),
      avatarUrl: authorHidden ? null : avatarUrls.get(comment.user_id) || null,
    }));
  });
}

/** Replace the note, stamp edited_at, and publish the update events (new mentions are notified downstream). */
export async function updateTaskCommentWithDb(
  db: Knex,
  tenant: string,
  user: TaskCommentActor,
  taskCommentId: string,
  input: Partial<Pick<IProjectTaskComment, 'note'>>,
  expectedRevision?: number,
): Promise<void> {
  const updates = { note: input?.note };
  const userId = user.user_id;

  return withTaskCommentAccess(db, user, tenant, { commentIds: [taskCommentId] }, 'update', async ({ trx, collaboration }) => {
    await assertCoManagedOperationalWrite(trx, tenant);
    const existingComment = await tenantScopedTable(trx, 'project_task_comments', tenant)
      .where({ task_comment_id: taskCommentId })
      .first();

    if (!existingComment) {
      throw new Error('Comment not found');
    }

    await assertNativeTaskNote(trx, tenant, existingComment, collaboration, { ownUserId: userId, expectedRevision });
    if (collaboration && existingComment.deleted_at) throw new Error('Comment not found');
    await assertOwnCommentOrInternalUser(trx, user, tenant, taskCommentId, existingComment.user_id, 'update');

    // Convert updated note to markdown
    const markdownContent = convertBlockNoteToMarkdown(updates.note);

    await tenantScopedTable(trx, 'project_task_comments', tenant)
      .where({ task_comment_id: taskCommentId })
      .update({
        collaboration_revision: trx.raw('collaboration_revision + 1'),
        note: updates.note,
        markdown_content: markdownContent,
        edited_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      });

    // Get task and project context for notifications
    const task = await loadTaskContext(trx, tenant, existingComment.task_id);
    const source = { tenantId: tenant, taskId: existingComment.task_id, taskCommentId };

    // Smart mention notifications: the handler compares old vs new mentions and only notifies new ones.
    await publishCommentEventAfterCommit(trx, 'TASK_COMMENT_UPDATED', source, () => publishWorkflowEvent({
      eventType: 'TASK_COMMENT_UPDATED',
      payload: buildTaskCommentUpdatedPayload({
        taskId: existingComment.task_id,
        projectId: task.project_id,
        updatedByUserId: userId,
        taskCommentId,
        taskName: task.task_name,
        oldCommentContent: existingComment.note,  // Old BlockNote JSON
        newCommentContent: updates.note ?? existingComment.note,          // New BlockNote JSON
      }),
      ctx: {
        tenantId: tenant,
        actor: { actorType: 'USER', actorUserId: userId },
      },
    }));

    await publishCommentEventAfterCommit(trx, 'PROJECT_TASK_COMMENT_UPDATED', source, () => publishEvent({
      eventType: 'PROJECT_TASK_COMMENT_UPDATED',
      payload: {
        tenantId: tenant,
        taskId: existingComment.task_id,
        projectId: task.project_id,
        userId,
        taskCommentId: taskCommentId,
        taskName: task.task_name,
        oldCommentContent: existingComment.note,
        newCommentContent: updates.note,
        isUpdate: true
      }
    }));
  });
}

/**
 * Remove a comment. One that still has replies, or any co-managed collaboration
 * comment, is soft-deleted so the thread and its history keep their shape; an
 * ordinary leaf is hard-deleted along with its reactions and thread
 * bookkeeping. Publishes PROJECT_TASK_COMMENT_DELETED either way.
 */
export async function deleteTaskCommentWithDb(
  db: Knex,
  tenant: string,
  user: TaskCommentActor,
  taskCommentId: string,
  expectedRevision?: number,
): Promise<void> {
  const userId = user.user_id;

  return withTaskCommentAccess(db, user, tenant, { commentIds: [taskCommentId] }, 'update', async ({ trx, collaboration }) => {
    await assertCoManagedOperationalWrite(trx, tenant);
    const existingComment = await tenantScopedTable(trx, 'project_task_comments', tenant)
      .where({ task_comment_id: taskCommentId })
      .first();

    if (!existingComment) {
      throw new Error('Comment not found');
    }

    await assertNativeTaskNote(trx, tenant, existingComment, collaboration, { ownUserId: userId, expectedRevision });
    if (collaboration && existingComment.deleted_at) return;
    await assertOwnCommentOrInternalUser(trx, user, tenant, taskCommentId, existingComment.user_id, 'delete');

    const task = await loadTaskContext(trx, tenant, existingComment.task_id);
    const source = { tenantId: tenant, taskId: existingComment.task_id, taskCommentId };
    const publishDeleted = () => publishCommentEventAfterCommit(trx, 'PROJECT_TASK_COMMENT_DELETED', source, () => publishEvent({
      eventType: 'PROJECT_TASK_COMMENT_DELETED',
      payload: {
        tenantId: tenant,
        taskId: existingComment.task_id,
        projectId: task.project_id,
        userId,
        taskCommentId,
        taskName: task.task_name,
        timestamp: new Date().toISOString(),
      }
    }));

    // Retain collaboration history; ordinary native comments also survive when they have replies.
    const child = await tenantScopedTable(trx, 'project_task_comments', tenant)
      .select('task_comment_id')
      .where({ parent_comment_id: taskCommentId })
      .first();

    if (child || collaboration) {
      const now = new Date().toISOString();
      await tenantScopedTable(trx, 'project_task_comments', tenant)
        .where({ task_comment_id: taskCommentId })
        .update({
          collaboration_revision: trx.raw('collaboration_revision + 1'),
          note: '[deleted]',
          markdown_content: '[deleted]',
          deleted_at: now,
          updated_at: now,
        });

      await publishDeleted();
      return;
    }

    // Delete reactions before hard-deleting the comment (CitusDB doesn't support ON DELETE CASCADE)
    await tenantScopedTable(trx, 'project_task_comment_reactions', tenant)
      .where({ task_comment_id: taskCommentId })
      .del();

    await tenantScopedTable(trx, 'project_task_comments', tenant)
      .where({ task_comment_id: taskCommentId })
      .del();

    if (existingComment.parent_comment_id) {
      await tenantScopedTable(trx, 'comment_threads', tenant)
        .where({ thread_id: existingComment.thread_id })
        .update({
          reply_count: trx.raw('GREATEST(reply_count - 1, 0)'),
        });
    } else {
      await tenantScopedTable(trx, 'comment_threads', tenant)
        .where({ thread_id: existingComment.thread_id })
        .del();
    }

    await publishDeleted();
  });
}

export async function countTaskCommentsWithDb(db: Knex, tenant: string, user: TaskCommentActor, taskId: string): Promise<number> {
  return withTaskCommentAccess(db, user, tenant, { taskIds: [taskId] }, 'read', async ({ trx }) => {
    const result = await tenantScopedTable(trx, 'project_task_comments', tenant)
      .where({ task_id: taskId })
      .count('* as count')
      .first();

    return parseInt(result?.count as string) || 0;
  });
}

export async function countTaskCommentsBatchWithDb(db: Knex, tenant: string, user: TaskCommentActor, input: string[]): Promise<Record<string, number>> {
  const taskIds = [...input];
  if (taskIds.length === 0) return {};

  return withTaskCommentAccess(db, user, tenant, { taskIds }, 'read', async ({ trx }) => {
    const results = await tenantScopedTable(trx, 'project_task_comments', tenant)
      .whereIn('task_id', taskIds)
      .groupBy('task_id')
      .select('task_id')
      .count('* as count');

    const counts: Record<string, number> = {};
    for (const row of results) {
      counts[row.task_id as string] = parseInt(row.count as string) || 0;
    }
    return counts;
  });
}

/**
 * Toggle a reaction on a project task comment.
 * If the user already reacted with this emoji, removes it. Otherwise, adds it.
 */
export async function toggleTaskCommentReactionWithDb(
  db: Knex,
  tenant: string,
  user: TaskCommentActor,
  taskCommentId: string,
  emoji: string,
): Promise<{ added: boolean }> {
  validateEmoji(emoji);
  const userId = user.user_id;

  return withTaskCommentAccess(db, user, tenant, { commentIds: [taskCommentId] }, 'update', async ({ trx, collaboration }) => {
    await assertCoManagedOperationalWrite(trx, tenant);
    const comment = await tenantScopedTable(trx, 'project_task_comments', tenant).where('task_comment_id', taskCommentId).first('task_id', 'deleted_at');
    if (!comment || comment.deleted_at || collaboration?.hidden(comment.task_id, ['author', 'reactions', 'project_task_comment_reactions'])) throw new CoManagedSharedWorkError();
    const existing = await tenantScopedTable(trx, 'project_task_comment_reactions', tenant)
      .where({ task_comment_id: taskCommentId, user_id: userId, emoji })
      .first();

    if (existing) {
      await tenantScopedTable(trx, 'project_task_comment_reactions', tenant)
        .where({ reaction_id: existing.reaction_id })
        .del();
      return { added: false };
    }

    await tenantScopedTable(trx, 'project_task_comment_reactions', tenant)
      .insert({ tenant, task_comment_id: taskCommentId, user_id: userId, emoji });

    return { added: true };
  });
}

type TaskCommentReactionRow = {
  task_comment_id: string;
  emoji: string;
  user_id: string;
};

type ReactionUserRow = {
  user_id: string;
  first_name?: string | null;
  last_name?: string | null;
};

/**
 * Get aggregated reactions for multiple task comments in a single query.
 * Also returns display names for all reacting users.
 */
export async function getTaskCommentsReactionsBatchWithDb(
  db: Knex,
  tenant: string,
  user: TaskCommentActor,
  input: string[],
): Promise<TaskCommentReactionsBatch> {
  const taskCommentIds = [...input];
  if (taskCommentIds.length === 0) return { reactions: {}, userNames: {} };

  return withTaskCommentAccess(db, user, tenant, { commentIds: taskCommentIds }, 'read', async ({ trx, collaboration }) => {
    if (collaboration) {
      const comments = await tenantScopedTable(trx, 'project_task_comments', tenant).whereIn('task_comment_id', taskCommentIds).select('task_id');
      if (comments.some((comment: { task_id: string }) => collaboration.hidden(comment.task_id, ['author', 'reactions', 'project_task_comment_reactions']))) throw new CoManagedSharedWorkError();
    }
    const rows = await tenantScopedTable(trx, 'project_task_comment_reactions', tenant)
      .whereIn('task_comment_id', taskCommentIds)
      .select('task_comment_id', 'emoji', 'user_id')
      .orderBy('created_at', 'asc') as TaskCommentReactionRow[];

    const reactions: Record<string, IAggregatedReaction[]> = aggregateReactions(rows, 'task_comment_id', user.user_id);

    // Collect unique user IDs and fetch display names
    const allUserIds = [...new Set(rows.map(r => r.user_id))];
    const userNames: Record<string, string> = {};
    if (allUserIds.length > 0) {
      const users = await tenantScopedTable(trx, 'users', tenant)
        .whereIn('user_id', allUserIds)
        .select('user_id', 'first_name', 'last_name') as ReactionUserRow[];
      for (const u of users) {
        userNames[u.user_id] = `${u.first_name || ''} ${u.last_name || ''}`.trim() || 'Unknown';
      }
    }

    return { reactions, userNames };
  });
}
