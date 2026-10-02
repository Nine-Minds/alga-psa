/**
 * Project Task Comment Service (REST)
 *
 * Thin adapter over the shared task comment service in @alga-psa/projects, which
 * the web server actions also use, so a comment written from mobile publishes
 * the same events and notifications as one written on the web. This layer only
 * resolves the tenant connection, maps domain errors to API errors, and shapes
 * the snake_case resource the REST API returns.
 */

import { BaseService, type ServiceContext } from '@alga-psa/db';
import type { IProjectTaskCommentWithUser } from '@alga-psa/types';
import {
  createTaskCommentWithDb,
  deleteTaskCommentWithDb,
  getTaskCommentById,
  getTaskCommentsReactionsBatchWithDb,
  listTaskCommentsWithDb,
  taskExists,
  toggleTaskCommentReactionWithDb,
  updateTaskCommentWithDb,
  type TaskCommentActor,
} from '@alga-psa/projects/lib/taskComments/taskCommentService';
import { ForbiddenError, NotFoundError, ValidationError } from '../middleware/apiMiddleware';
import type { ProjectTaskCommentReactionResponse, ProjectTaskCommentResponse } from '../schemas/projectTaskComment';

function actorFrom(context: ServiceContext): TaskCommentActor {
  const user = context.user as { user_id?: string; user_type?: 'internal' | 'client' } | undefined;
  return {
    user_id: user?.user_id ?? context.userId,
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

  async assertTaskExists(taskId: string, context: ServiceContext): Promise<void> {
    const knex = await this.getDbForContext(context);
    if (!(await taskExists(knex, context.tenant, taskId))) {
      throw new NotFoundError('Task not found');
    }
  }

  /** 404 unless the comment exists and sits on this task. */
  private async requireCommentOnTask(taskId: string, commentId: string, context: ServiceContext): Promise<void> {
    const knex = await this.getDbForContext(context);
    const comment = await getTaskCommentById(knex, context.tenant, commentId);
    if (!comment || comment.task_id !== taskId) {
      throw new NotFoundError('Comment not found');
    }
  }

  private shape(
    comment: IProjectTaskCommentWithUser,
    reactions: Record<string, ProjectTaskCommentResponse['reactions']>,
    reactionUserNames: Record<string, string>,
  ): ProjectTaskCommentResponse {
    return {
      task_comment_id: comment.taskCommentId,
      task_id: comment.taskId,
      thread_id: comment.threadId ?? null,
      parent_comment_id: comment.parentCommentId ?? null,
      user_id: comment.userId,
      author_type: 'internal',
      note: comment.note,
      markdown_content: comment.markdownContent ?? null,
      created_at: comment.createdAt,
      updated_at: comment.updatedAt ?? null,
      edited_at: comment.editedAt ?? null,
      deleted_at: comment.deletedAt ?? null,
      author: comment.userId
        ? {
            user_id: comment.userId,
            first_name: comment.firstName ?? null,
            last_name: comment.lastName ?? null,
            email: comment.email ?? null,
            avatar_url: comment.avatarUrl ?? null,
          }
        : null,
      reactions: reactions[comment.taskCommentId] ?? [],
      reaction_user_names: reactionUserNames,
    };
  }

  async listComments(taskId: string, context: ServiceContext): Promise<ProjectTaskCommentResponse[]> {
    const knex = await this.getDbForContext(context);
    const comments = await listTaskCommentsWithDb(knex, context.tenant, taskId);
    const batch = await getTaskCommentsReactionsBatchWithDb(
      knex,
      context.tenant,
      context.userId,
      comments.map((comment) => comment.taskCommentId),
    );
    return comments.map((comment) => this.shape(comment, batch.reactions, batch.userNames));
  }

  async getOne(taskId: string, commentId: string, context: ServiceContext): Promise<ProjectTaskCommentResponse> {
    const [match] = (await this.listComments(taskId, context)).filter((comment) => comment.task_comment_id === commentId);
    if (!match) {
      throw new NotFoundError('Comment not found');
    }
    return match;
  }

  async createComment(
    taskId: string,
    data: { note: string; parent_comment_id?: string | null },
    context: ServiceContext,
  ): Promise<ProjectTaskCommentResponse> {
    const knex = await this.getDbForContext(context);
    if (data.parent_comment_id) {
      await this.requireCommentOnTask(taskId, data.parent_comment_id, context);
    }
    let commentId: string;
    try {
      commentId = await createTaskCommentWithDb(knex, context.tenant, actorFrom(context), {
        taskId,
        note: data.note,
        parentCommentId: data.parent_comment_id ?? null,
      });
    } catch (error) {
      throwTaskCommentApiError(error);
    }
    return this.getOne(taskId, commentId, context);
  }

  async updateComment(
    taskId: string,
    commentId: string,
    data: { note: string },
    context: ServiceContext,
  ): Promise<ProjectTaskCommentResponse> {
    await this.requireCommentOnTask(taskId, commentId, context);
    const knex = await this.getDbForContext(context);
    try {
      await updateTaskCommentWithDb(knex, context.tenant, actorFrom(context), commentId, { note: data.note });
    } catch (error) {
      throwTaskCommentApiError(error);
    }
    return this.getOne(taskId, commentId, context);
  }

  async deleteComment(taskId: string, commentId: string, context: ServiceContext): Promise<void> {
    await this.requireCommentOnTask(taskId, commentId, context);
    const knex = await this.getDbForContext(context);
    try {
      await deleteTaskCommentWithDb(knex, context.tenant, actorFrom(context), commentId);
    } catch (error) {
      throwTaskCommentApiError(error);
    }
  }

  async toggleReaction(
    taskId: string,
    commentId: string,
    emoji: string,
    context: ServiceContext,
  ): Promise<ProjectTaskCommentReactionResponse> {
    await this.requireCommentOnTask(taskId, commentId, context);
    const knex = await this.getDbForContext(context);
    let added: boolean;
    try {
      ({ added } = await toggleTaskCommentReactionWithDb(knex, context.tenant, context.userId, commentId, emoji));
    } catch (error) {
      throwTaskCommentApiError(error);
    }
    const batch = await getTaskCommentsReactionsBatchWithDb(knex, context.tenant, context.userId, [commentId]);
    return { added, reactions: batch.reactions[commentId] ?? [], reaction_user_names: batch.userNames };
  }
}
