/**
 * Project Task Comment Service (REST)
 *
 * Thin adapter over the shared task comment service in @alga-psa/projects, which
 * the web server actions also use, so a comment written from mobile publishes
 * the same events and notifications as one written on the web. This layer only
 * resolves the tenant connection, maps domain errors to API errors, and shapes
 * the snake_case resource the REST API returns.
 */

import type { Knex } from 'knex';
import { BaseService, type ServiceContext } from '@alga-psa/db';
import { redactTaskComment, redactTaskCommentReactions } from '@alga-psa/types';
import type { IProjectTaskCommentWithUser, IUserWithRoles } from '@alga-psa/types';
import {
  createTaskCommentWithDb,
  deleteTaskCommentWithDb,
  getTaskCommentById,
  getTaskCommentsReactionsBatchWithDb,
  listTaskCommentsWithDb,
  toggleTaskCommentReactionWithDb,
  updateTaskCommentWithDb,
  type TaskCommentActor,
} from '@alga-psa/projects/lib/taskComments/taskCommentService';
import {
  withTaskCommentAccess,
  type TaskCommentAction,
  type TaskCommentTarget,
} from '@alga-psa/projects/lib/taskComments/taskCommentAuthorization';
import { collaborationFieldPolicy, type TaskCommentCollaboration } from '@alga-psa/projects/lib/taskComments/taskCommentCollaboration';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../middleware/apiMiddleware';
import type { ProjectTaskCommentReactionResponse, ProjectTaskCommentResponse } from '../schemas/projectTaskComment';

function actorFrom(context: ServiceContext): TaskCommentActor {
  const user = context.user as { user_id?: string; user_type?: 'internal' | 'client' | 'service' } | undefined;
  return {
    user_id: user?.user_id ?? context.userId,
    // Only a missing (legacy) type defaults to internal; 'service' is preserved.
    user_type: user?.user_type ?? 'internal',
  };
}

/** The shared service throws plain Errors with fixed messages; give them HTTP meaning. */
function throwTaskCommentApiError(error: unknown): never {
  if (error instanceof Error) {
    const message = error.message;
    if (message === 'Task not found' || message === 'Comment not found' || message === 'Parent task comment not found') {
      throw new NotFoundError(message);
    }
    if (message.startsWith('Task comment was changed')) {
      throw new ConflictError(message);
    }
    if (message.startsWith('Permission denied')) {
      throw new ForbiddenError(message);
    }
    if (message === 'Only internal users can comment on tasks' || message.startsWith('You can only ')) {
      throw new ForbiddenError(message);
    }
    if (
      message === 'Parent task comment must belong to the same task' ||
      message === 'Cannot reply to a deleted task comment' ||
      message.startsWith('Invalid emoji')
    ) {
      throw new ValidationError(message);
    }
  }
  throw error;
}

export class ProjectTaskCommentService extends BaseService<never> {
  constructor() {
    super({ tableName: 'project_task_comments', primaryKey: 'task_comment_id', tenantColumn: 'tenant' });
  }

  /**
   * The single authorization boundary for every REST comment operation: coarse project_task permission,
   * parent-project record authorization and ownership are decided in one transaction before `work` runs.
   * A missing and a forbidden task/comment both surface as the same 404.
   */
  private async withAccess<T>(
    context: ServiceContext,
    target: TaskCommentTarget,
    action: TaskCommentAction,
    work: (trx: Knex.Transaction, access: { taskId: string; collaboration?: TaskCommentCollaboration }) => Promise<T>,
  ): Promise<T> {
    const knex = await this.getDbForContext(context);
    try {
      return await withTaskCommentAccess(knex, context.tenant, context.user as IUserWithRoles, target, action, ({ trx, taskId, collaboration }) =>
        work(trx, { taskId, ...(collaboration ? { collaboration } : {}) }),
      );
    } catch (error) {
      throwTaskCommentApiError(error);
    }
  }

  /** 404 unless the comment exists and sits on this task. */
  private async requireCommentOnTask(trx: Knex.Transaction, taskId: string, commentId: string, context: ServiceContext): Promise<void> {
    const comment = await getTaskCommentById(trx, context.tenant, commentId);
    if (!comment || comment.task_id !== taskId) {
      throw new Error('Comment not found');
    }
  }

  private shape(
    comment: IProjectTaskCommentWithUser,
    reactions: Record<string, ProjectTaskCommentResponse['reactions']>,
    reactionUserNames: Record<string, string>,
    collaboration?: TaskCommentCollaboration,
  ): ProjectTaskCommentResponse {
    // The same single redaction function the web UI and the search indexer call.
    if (collaboration) comment = redactTaskComment(comment, collaborationFieldPolicy(collaboration, comment.taskId));
    return {
      task_comment_id: comment.taskCommentId,
      task_id: comment.taskId,
      thread_id: comment.threadId ?? null,
      parent_comment_id: comment.parentCommentId ?? null,
      user_id: comment.userId,
      author_type: comment.authorType ?? 'internal',
      note: comment.note,
      markdown_content: comment.markdownContent ?? null,
      created_at: comment.createdAt,
      updated_at: comment.updatedAt ?? null,
      edited_at: comment.editedAt ?? null,
      deleted_at: comment.deletedAt ?? null,
      // Collaborator- and contact-authored rows have no users row: their saved label is the author.
      author: comment.userId || comment.firstName
        ? {
            user_id: comment.userId,
            first_name: comment.firstName ?? null,
            last_name: comment.lastName ?? null,
            email: comment.email ?? null,
            avatar_url: comment.avatarUrl ?? null,
          }
        : null,
      ...(collaboration ? {
        organization_name: comment.organizationName ?? null,
        author_kind: comment.authorKind ?? 'user',
        audience: comment.audience,
        ...(comment.collaborationRevision !== undefined ? { collaboration_revision: comment.collaborationRevision } : {}),
      } : {}),
      reactions: reactions[comment.taskCommentId] ?? [],
      reaction_user_names: reactionUserNames,
    };
  }

  private async listWithDb(db: Knex, taskId: string, context: ServiceContext, collaboration?: TaskCommentCollaboration): Promise<ProjectTaskCommentResponse[]> {
    const comments = await listTaskCommentsWithDb(db, context.tenant, taskId, { ...(collaboration ? { collaboration } : {}), viewerUserId: context.userId });
    let batch = await getTaskCommentsReactionsBatchWithDb(
      db,
      context.tenant,
      context.userId,
      comments.map((comment) => comment.taskCommentId),
    );
    // Reactions keep their count inside the audience; the reactor labels follow the project's redaction policy.
    if (collaboration) batch = redactTaskCommentReactions(batch, collaborationFieldPolicy(collaboration, taskId));
    return comments.map((comment) => this.shape(comment, batch.reactions, batch.userNames, collaboration));
  }

  async listComments(taskId: string, context: ServiceContext): Promise<ProjectTaskCommentResponse[]> {
    return this.withAccess(context, { taskId }, 'read', (trx, { collaboration }) => this.listWithDb(trx, taskId, context, collaboration));
  }

  private async getOneWithDb(db: Knex, taskId: string, commentId: string, context: ServiceContext, collaboration?: TaskCommentCollaboration): Promise<ProjectTaskCommentResponse> {
    const match = (await this.listWithDb(db, taskId, context, collaboration)).find((comment) => comment.task_comment_id === commentId);
    if (!match) {
      throw new Error('Comment not found');
    }
    return match;
  }

  async createComment(
    taskId: string,
    data: { note: string; parent_comment_id?: string | null },
    context: ServiceContext,
  ): Promise<ProjectTaskCommentResponse> {
    return this.withAccess(context, { taskId }, 'create', async (trx, { collaboration }) => {
      if (data.parent_comment_id) {
        await this.requireCommentOnTask(trx, taskId, data.parent_comment_id, context);
      }
      const commentId = await createTaskCommentWithDb(trx, context.tenant, actorFrom(context), {
        taskId,
        note: data.note,
        parentCommentId: data.parent_comment_id ?? null,
      }, { collaboration });
      return this.getOneWithDb(trx, taskId, commentId, context, collaboration);
    });
  }

  async updateComment(
    taskId: string,
    commentId: string,
    data: { note: string },
    context: ServiceContext,
  ): Promise<ProjectTaskCommentResponse> {
    return this.withAccess(context, { taskCommentId: commentId }, 'update', async (trx, { collaboration }) => {
      await this.requireCommentOnTask(trx, taskId, commentId, context);
      await updateTaskCommentWithDb(trx, context.tenant, actorFrom(context), commentId, { note: data.note }, { collaboration });
      return this.getOneWithDb(trx, taskId, commentId, context, collaboration);
    });
  }

  async deleteComment(taskId: string, commentId: string, context: ServiceContext): Promise<void> {
    await this.withAccess(context, { taskCommentId: commentId }, 'delete', async (trx, { collaboration }) => {
      await this.requireCommentOnTask(trx, taskId, commentId, context);
      await deleteTaskCommentWithDb(trx, context.tenant, actorFrom(context), commentId, { collaboration });
    });
  }

  async toggleReaction(
    taskId: string,
    commentId: string,
    emoji: string,
    context: ServiceContext,
  ): Promise<ProjectTaskCommentReactionResponse> {
    return this.withAccess(context, { taskCommentId: commentId }, 'react', async (trx, { collaboration }) => {
      await this.requireCommentOnTask(trx, taskId, commentId, context);
      const { added } = await toggleTaskCommentReactionWithDb(trx, context.tenant, context.userId, commentId, emoji, { collaboration });
      let batch = await getTaskCommentsReactionsBatchWithDb(trx, context.tenant, context.userId, [commentId]);
      if (collaboration) batch = redactTaskCommentReactions(batch, collaborationFieldPolicy(collaboration, taskId));
      return { added, reactions: batch.reactions[commentId] ?? [], reaction_user_names: batch.userNames };
    });
  }
}
