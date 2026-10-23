/**
 * API Project Task Comment Controller
 * Comments and reactions on a project task, for API-key clients (mobile).
 *
 * Reads are gated on `project_task:read`, the same permission the web uses for
 * task comment counts. Writes are additionally gated by the shared service:
 * only internal users may comment, and a non-internal caller may only edit or
 * delete their own comment — exactly what the web server actions enforce.
 */

import { NextRequest, NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { ApiBaseController } from './ApiBaseController';
import { ProjectTaskCommentService } from '../services/ProjectTaskCommentService';
import {
  createProjectTaskCommentSchema,
  toggleProjectTaskCommentReactionSchema,
  updateProjectTaskCommentSchema,
} from '../schemas/projectTaskComment';
import { runWithTenant } from '../../db';
import {
  AuthenticatedApiRequest,
  ValidationError,
  createSuccessResponse,
  handleApiError,
} from '../middleware/apiMiddleware';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class ApiProjectTaskCommentController extends ApiBaseController {
  private commentService: ProjectTaskCommentService;

  constructor() {
    const commentService = new ProjectTaskCommentService();
    super(commentService, {
      resource: 'project_task',
      permissions: { read: 'read', list: 'read' },
    });
    this.commentService = commentService;
  }

  /** `.../tasks/{taskId}/comments[/{commentId}[/reactions]]` */
  private pathIds(req: NextRequest, needComment: boolean): { taskId: string; commentId: string | null } {
    const parts = new URL(req.url).pathname.split('/');
    const tasksIndex = parts.indexOf('tasks');
    const taskId = parts[tasksIndex + 1];
    const commentsIndex = parts.indexOf('comments', tasksIndex);
    const commentId = commentsIndex > -1 ? parts[commentsIndex + 1] ?? null : null;
    if (!taskId || !UUID_RE.test(taskId)) throw new ValidationError('Invalid task ID format');
    if (needComment && (!commentId || !UUID_RE.test(commentId))) throw new ValidationError('Invalid comment ID format');
    return { taskId, commentId: commentId && UUID_RE.test(commentId) ? commentId : null };
  }

  private async parseBody<T>(req: NextRequest, parse: (body: unknown) => T): Promise<T> {
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      throw new ValidationError('Request body must be JSON');
    }
    try {
      return parse(body);
    } catch (error) {
      if (error instanceof ZodError) {
        throw new ValidationError('Validation failed', error.errors);
      }
      throw error;
    }
  }

  private handle(
    needComment: boolean,
    run: (ids: { taskId: string; commentId: string | null }, apiRequest: AuthenticatedApiRequest, req: NextRequest) => Promise<NextResponse>,
  ) {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        const apiRequest = await this.authenticate(req) as AuthenticatedApiRequest;
        const ids = this.pathIds(req, needComment);
        return await runWithTenant(apiRequest.context.tenant, async () => {
          await this.checkPermission(apiRequest, 'read');
          await this.commentService.assertTaskExists(ids.taskId, apiRequest.context);
          return run(ids, apiRequest, req);
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  list() {
    return this.handle(false, async ({ taskId }, apiRequest) => {
      const comments = await this.commentService.listComments(taskId, apiRequest.context);
      return createSuccessResponse(comments);
    });
  }

  create() {
    return this.handle(false, async ({ taskId }, apiRequest, req) => {
      const data = await this.parseBody(req, (body) => createProjectTaskCommentSchema.parse(body));
      const comment = await this.commentService.createComment(taskId, data, apiRequest.context);
      return createSuccessResponse(comment, 201);
    });
  }

  update() {
    return this.handle(true, async ({ taskId, commentId }, apiRequest, req) => {
      const data = await this.parseBody(req, (body) => updateProjectTaskCommentSchema.parse(body));
      const comment = await this.commentService.updateComment(taskId, commentId!, data, apiRequest.context);
      return createSuccessResponse(comment);
    });
  }

  delete() {
    return this.handle(true, async ({ taskId, commentId }, apiRequest) => {
      await this.commentService.deleteComment(taskId, commentId!, apiRequest.context);
      return new NextResponse(null, { status: 204 });
    });
  }

  toggleReaction() {
    return this.handle(true, async ({ taskId, commentId }, apiRequest, req) => {
      const { emoji } = await this.parseBody(req, (body) => toggleProjectTaskCommentReactionSchema.parse(body));
      const result = await this.commentService.toggleReaction(taskId, commentId!, emoji, apiRequest.context);
      return createSuccessResponse(result);
    });
  }
}
