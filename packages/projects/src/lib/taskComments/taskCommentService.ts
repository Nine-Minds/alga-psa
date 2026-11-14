/**
 * Project task comments and reactions — the one implementation behind both
 * the web server actions (projectTaskCommentActions / ...ReactionActions) and
 * the REST API (ApiProjectTaskCommentController). Keeping a single writer here
 * means a comment added from the mobile app publishes the same events, and so
 * fires the same mention and assignee notifications, as one added on the web.
 *
 * Callers own authentication, tenant context and authorization (withTaskCommentAccess); every function takes the
 * connection, tenant and acting user explicitly. Failures are thrown as plain
 * Errors with the messages the action-layer mapper already understands.
 */

import { tenantDb, withTransaction } from '@alga-psa/db';
import { convertBlockNoteToMarkdown } from '@alga-psa/formatting/blocknoteUtils';
import { getEntityImageUrlsBatch } from '@alga-psa/formatting/avatarUtils';
import { publishCommentEvent } from '@alga-psa/db/commentEventRegistry';
import { publishEvent, publishWorkflowEvent } from '@alga-psa/event-bus/publishers';
import { buildTaskCommentAddedPayload, buildTaskCommentUpdatedPayload } from '@alga-psa/workflow-streams';
import { aggregateReactions, isMspPrincipalUserType, validateEmoji } from '@alga-psa/types';
import { redactTaskComment } from '@alga-psa/types';
import type { IAggregatedReaction, IProjectTaskComment, IProjectTaskCommentWithUser, IReactionsBatchResult } from '@alga-psa/types';
import type { Knex } from 'knex';
import { assertNativeTaskNote, collaborationFieldPolicy, type TaskCommentCollaboration } from './taskCommentCollaboration';
import { projectTaskAudience } from '@alga-psa/co-managed/projectTaskAudience';

export type TaskCommentActor = { user_id: string; user_type: 'internal' | 'client' | 'service' };

/** Present only for an active co-managed workspace (resolved by withTaskCommentAccess); absent = native path. */
export type TaskCommentCollaborationOptions = { collaboration?: TaskCommentCollaboration };

export type CreateTaskCommentInput = {
  taskId: string;
  note: string;
  parentCommentId?: string | null;
};

/** A stored comment row as the database returns it. */
export type TaskCommentRow = {
  task_comment_id: string;
  task_id: string;
  thread_id: string | null;
  parent_comment_id: string | null;
  /** Null for collaborator- and contact-authored rows. */
  user_id: string | null;
  author_type: 'internal' | 'client';
  actor_reference_id?: string | null;
  author_kind?: 'user' | 'contact' | null;
  collaboration_revision?: number | null;
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
export async function taskExists(db: Knex, tenant: string, taskId: string): Promise<boolean> {
  const row = await tenantScopedTable(db, 'project_tasks', tenant)
    .where({ task_id: taskId })
    .select('task_id')
    .first();
  return Boolean(row);
}

export async function getTaskCommentById(
  db: Knex | Knex.Transaction,
  tenant: string,
  taskCommentId: string,
): Promise<TaskCommentRow | null> {
  const row = await tenantScopedTable(db, 'project_task_comments', tenant)
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
  comment: CreateTaskCommentInput,
  options: TaskCommentCollaborationOptions = {},
): Promise<string> {
  const { collaboration } = options;
  return withTransaction(db, async (trx: Knex.Transaction) => {
    const userId = user.user_id;

    // Verify user is internal
    const userRecord = await tenantScopedTable(trx, 'users', tenant)
      .where({ user_id: userId })
      .first();

    if (!userRecord || !isMspPrincipalUserType(userRecord.user_type)) {
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
        .select(...(collaboration ? ['*'] : ['task_comment_id', 'task_id', 'thread_id', 'deleted_at']))
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

      // Co-managed: a native reply may only continue an organization-private thread.
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
        // Native task comments are organization-private in a co-managed workspace; legacy rows stay NULL.
        ...(collaboration ? { is_internal: true, collaboration_audience: 'organization_private' } : { is_internal: false }),
        reply_count: 0,
        last_activity_at: now,
        created_at: now,
        created_by: userId,
      });
    }

    if (!taskCommentId || !threadId) {
      throw new Error('Database UUID generation did not return task comment/thread identifiers.');
    }

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
        note: comment.note,
        markdown_content: markdownContent,
        ...(collaboration ? { collaboration_revision: 1 } : {}),
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

    // Publish event (mention extraction happens in event handler)
    await publishCommentEvent(trx, 'project-task', {
      tenantId: tenant,
      taskId: comment.taskId,
      commentId: newComment.task_comment_id,
      userId,
      eventType: 'TASK_COMMENT_ADDED',
    }, async () => {
      await publishWorkflowEvent({
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
      });

      await publishEvent({
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
      });
    });

    return newComment.task_comment_id;
  });
}

/** Every comment on a task, oldest first, with the author joined and avatars resolved. */
export async function listTaskCommentsWithDb(
  db: Knex,
  tenant: string,
  taskId: string,
  options: TaskCommentCollaborationOptions & { viewerUserId?: string } = {},
): Promise<IProjectTaskCommentWithUser[]> {
  const { collaboration } = options;
  const commentsQuery = tenantScopedTable(db, 'project_task_comments', tenant);
  tenantDb(db, tenant).tenantJoin(commentsQuery, 'users', 'project_task_comments.user_id', 'users.user_id', { type: 'left' });
  const comments = await commentsQuery
    .where({ 'project_task_comments.task_id': taskId })
    .select(
      'project_task_comments.*',
      'users.first_name',
      'users.last_name',
      'users.email'
    )
    .orderBy('project_task_comments.created_at', 'asc') as any[];

  // Co-managed: audience comes from the thread; the thread rows are fetched once for the task.
  const threadAudience = new Map<string, ReturnType<typeof projectTaskAudience>>();
  if (collaboration) {
    const threads = await tenantScopedTable(db, 'comment_threads', tenant)
      .where({ project_task_id: taskId }).whereNull('ticket_id')
      .select('thread_id', 'collaboration_audience', 'is_internal') as any[];
    for (const thread of threads) threadAudience.set(thread.thread_id, projectTaskAudience(thread));
  }
  const rootDeleted = new Set<string>(comments.filter((c: any) => !c.parent_comment_id && c.deleted_at).map((c: any) => c.thread_id));

  // Get avatar URLs for all users
  const userIds: string[] = [
    ...new Set(
      comments
        .map((c: any) => c.user_id)
        .filter((id): id is string => typeof id === 'string' && id.length > 0)
    ),
  ];
  const avatarUrls = tenant ? await getEntityImageUrlsBatch('user', userIds, tenant) : new Map<string, string | null>();

  // Map snake_case to camelCase
  const mapped = comments.map((comment: any): IProjectTaskCommentWithUser => {
    const base: IProjectTaskCommentWithUser = {
      taskCommentId: comment.task_comment_id,
      taskId: comment.task_id,
      threadId: comment.thread_id,
      parentCommentId: comment.parent_comment_id,
      userId: comment.user_id,
      authorType: comment.author_type,
      note: comment.note,
      markdownContent: comment.markdown_content,
      createdAt: comment.created_at,
      updatedAt: comment.updated_at,
      editedAt: comment.edited_at,
      deletedAt: comment.deleted_at,
      tenant: comment.tenant,
      firstName: comment.first_name,
      lastName: comment.last_name,
      email: comment.email,
      avatarUrl: avatarUrls.get(comment.user_id) || null,
    };
    if (!collaboration) return base;

    // A missing author kind is a row written before contact authorship existed: a user.
    const authorKind: 'user' | 'contact' = comment.author_kind === 'contact' ? 'contact' : 'user';
    const audience = threadAudience.get(comment.thread_id) ?? 'organization_private';
    const deleted = Boolean(comment.deleted_at);
    const qualified = Boolean(comment.actor_reference_id) || authorKind === 'contact';
    const ownNote = !qualified && audience === 'organization_private' && !deleted && comment.user_id === options.viewerUserId;
    const labelled: IProjectTaskCommentWithUser = {
      ...base,
      // Qualified authors have no local login: their saved label stands in for the joined user.
      ...(qualified ? { firstName: comment.actor_display_name ?? '', lastName: '', email: '' } : {}),
      organizationName: comment.actor_organization_name ?? undefined,
      authorKind,
      actorReferenceId: comment.actor_reference_id ?? null,
      contactId: comment.contact_id ?? null,
      audience,
      collaborationRevision: comment.collaboration_revision ?? 1,
      // A tombstone keeps its place but never its text.
      ...(deleted ? { note: '[deleted]', markdownContent: '[deleted]' } : {}),
      canEdit: ownNote,
      canReply: !deleted && audience === 'organization_private' && !rootDeleted.has(comment.thread_id) && !qualified,
      canReact: !deleted && audience === 'organization_private' && !qualified,
    };
    return redactTaskComment(labelled, collaborationFieldPolicy(collaboration, taskId));
  });
  return mapped;
}

/** Replace the note, stamp edited_at, and publish the update events (new mentions are notified downstream). */
export async function updateTaskCommentWithDb(
  db: Knex,
  tenant: string,
  user: TaskCommentActor,
  taskCommentId: string,
  updates: Partial<Pick<IProjectTaskComment, 'note'>>,
  options: TaskCommentCollaborationOptions & { expectedRevision?: number } = {},
): Promise<void> {
  const userId = user.user_id;
  const { collaboration } = options;

  return withTransaction(db, async (trx: Knex.Transaction) => {
    const existingComment = await tenantScopedTable(trx, 'project_task_comments', tenant)
      .where({ task_comment_id: taskCommentId })
      .first();

    if (!existingComment) {
      throw new Error('Comment not found');
    }

    // Authorization (ownership, project access) is enforced by withTaskCommentAccess before this runs.
    await assertNativeTaskNote(trx, tenant, existingComment, collaboration, { ownUserId: userId, expectedRevision: options.expectedRevision });

    // Convert updated note to markdown
    const markdownContent = convertBlockNoteToMarkdown(updates.note);

    await tenantScopedTable(trx, 'project_task_comments', tenant)
      .where({ task_comment_id: taskCommentId })
      .update({
        note: updates.note,
        markdown_content: markdownContent,
        ...(collaboration ? { collaboration_revision: (existingComment.collaboration_revision ?? 1) + 1 } : {}),
        edited_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      });

    // Get task and project context for notifications
    const task = await loadTaskContext(trx, tenant, existingComment.task_id);

    // Publish event for smart mention notifications
    // Event handler will compare old vs new mentions and only notify NEW ones
    await publishCommentEvent(trx, 'project-task', {
      tenantId: tenant,
      taskId: existingComment.task_id,
      commentId: taskCommentId,
      userId,
      eventType: 'TASK_COMMENT_UPDATED',
    }, async () => {
      await publishWorkflowEvent({
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
      });

      await publishEvent({
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
      });
    });
  });
}

/**
 * Remove a comment. One that still has replies is soft-deleted so the thread
 * keeps its shape; a leaf is hard-deleted along with its reactions and thread
 * bookkeeping. Publishes PROJECT_TASK_COMMENT_DELETED either way.
 */
export async function deleteTaskCommentWithDb(
  db: Knex,
  tenant: string,
  user: TaskCommentActor,
  taskCommentId: string,
  options: TaskCommentCollaborationOptions & { expectedRevision?: number } = {},
): Promise<void> {
  const userId = user.user_id;
  const { collaboration } = options;

  return withTransaction(db, async (trx: Knex.Transaction) => {
    const existingComment = await tenantScopedTable(trx, 'project_task_comments', tenant)
      .where({ task_comment_id: taskCommentId })
      .first();

    if (!existingComment) {
      throw new Error('Comment not found');
    }

    // Authorization (ownership, project access) is enforced by withTaskCommentAccess before this runs.
    await assertNativeTaskNote(trx, tenant, existingComment, collaboration, { ownUserId: userId, expectedRevision: options.expectedRevision });

    const task = await loadTaskContext(trx, tenant, existingComment.task_id);

    // If the comment still has replies, soft-delete it so the thread structure survives
    const child = await tenantScopedTable(trx, 'project_task_comments', tenant)
      .select('task_comment_id')
      .where({ parent_comment_id: taskCommentId })
      .first();

    // Co-managed: every delete is a tombstone, so the revision history and the audience's replies stay intact.
    if (child || collaboration) {
      const now = new Date().toISOString();
      await tenantScopedTable(trx, 'project_task_comments', tenant)
        .where({ task_comment_id: taskCommentId })
        .update({
          note: '[deleted]',
          markdown_content: '[deleted]',
          deleted_at: now,
          updated_at: now,
          ...(collaboration ? { collaboration_revision: (existingComment.collaboration_revision ?? 1) + 1 } : {}),
        });

      await publishEvent({
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
      });
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

    await publishEvent({
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
    });
  });
}

export async function countTaskCommentsWithDb(db: Knex, tenant: string, taskId: string): Promise<number> {
  const result = await tenantScopedTable(db, 'project_task_comments', tenant)
    .where({ task_id: taskId })
    .count('* as count')
    .first();

  return parseInt(result?.count as string) || 0;
}

export async function countTaskCommentsBatchWithDb(db: Knex, tenant: string, taskIds: string[]): Promise<Record<string, number>> {
  if (taskIds.length === 0) return {};

  const results = await tenantScopedTable(db, 'project_task_comments', tenant)
    .whereIn('task_id', taskIds)
    .groupBy('task_id')
    .select('task_id')
    .count('* as count');

  const counts: Record<string, number> = {};
  for (const row of results) {
    counts[row.task_id as string] = parseInt(row.count as string) || 0;
  }
  return counts;
}

/**
 * Toggle a reaction on a project task comment.
 * If the user already reacted with this emoji, removes it. Otherwise, adds it.
 */
export async function toggleTaskCommentReactionWithDb(
  db: Knex,
  tenant: string,
  userId: string,
  taskCommentId: string,
  emoji: string,
  options: TaskCommentCollaborationOptions = {},
): Promise<{ added: boolean }> {
  validateEmoji(emoji);

  return withTransaction(db, async (trx) => {
    if (options.collaboration) {
      // Reactions live inside the audience: only a live organization-private note can be reacted to natively.
      const target = await getTaskCommentById(trx, tenant, taskCommentId);
      if (!target) throw new Error('Comment not found');
      await assertNativeTaskNote(trx, tenant, target, options.collaboration, { reply: true });
    }
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
  currentUserId: string,
  taskCommentIds: string[],
): Promise<TaskCommentReactionsBatch> {
  if (taskCommentIds.length === 0) return { reactions: {}, userNames: {} };

  const rows = await tenantScopedTable(db, 'project_task_comment_reactions', tenant)
    .whereIn('task_comment_id', taskCommentIds)
    .select('task_comment_id', 'emoji', 'user_id')
    .orderBy('created_at', 'asc') as TaskCommentReactionRow[];

  const reactions: Record<string, IAggregatedReaction[]> = aggregateReactions(rows, 'task_comment_id', currentUserId);

  // Collect unique user IDs and fetch display names
  const allUserIds = [...new Set(rows.map(r => r.user_id))];
  const userNames: Record<string, string> = {};
  if (allUserIds.length > 0) {
    const users = await tenantScopedTable(db, 'users', tenant)
      .whereIn('user_id', allUserIds)
      .select('user_id', 'first_name', 'last_name') as ReactionUserRow[];
    for (const u of users) {
      userNames[u.user_id] = `${u.first_name || ''} ${u.last_name || ''}`.trim() || 'Unknown';
    }
  }

  return { reactions, userNames };
}
