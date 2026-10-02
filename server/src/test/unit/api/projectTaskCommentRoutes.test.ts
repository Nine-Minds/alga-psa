import { describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('next/server', async () => ({
  ...await import('next/dist/server/web/spec-extension/request'),
  ...await import('next/dist/server/web/spec-extension/response'),
}));

vi.mock('../../../lib/db', () => ({
  runWithTenant: (_tenant: string, callback: () => Promise<unknown>) => callback(),
}));

import { ApiProjectTaskCommentController } from '../../../lib/api/controllers/ApiProjectTaskCommentController';
import type { AuthenticatedApiRequest } from '../../../lib/api/controllers/ApiBaseController';
import { ProjectTaskCommentService } from '../../../lib/api/services/ProjectTaskCommentService';
import { NotFoundError } from '../../../lib/api/middleware/apiMiddleware';
import { createRegistry } from '../../../lib/api/openapi/registry';
import { registerProjectRoutes } from '../../../lib/api/openapi/routes/projects';
import { zOpenApi } from '../../../lib/api/openapi/registry';

const taskId = '00000000-0000-4000-8000-000000000001';
const commentId = '00000000-0000-4000-8000-000000000002';

const resource = {
  task_comment_id: commentId,
  task_id: taskId,
  thread_id: '00000000-0000-4000-8000-000000000003',
  parent_comment_id: null,
  user_id: '00000000-0000-4000-8000-000000000009',
  author_type: 'internal',
  note: '[{"type":"paragraph","content":[{"type":"text","text":"hi","styles":{}}]}]',
  markdown_content: 'hi',
  created_at: '2026-10-02T10:00:00.000Z',
  updated_at: null,
  edited_at: null,
  deleted_at: null,
  author: { user_id: '00000000-0000-4000-8000-000000000009', first_name: 'Sam', last_name: 'Lee', email: 'sam@acme.test', avatar_url: null },
  reactions: [{ emoji: '👍', count: 1, userIds: ['00000000-0000-4000-8000-000000000009'], currentUserReacted: true }],
  reaction_user_names: { '00000000-0000-4000-8000-000000000009': 'Sam Lee' },
};

class TestController extends ApiProjectTaskCommentController {
  permissionChecks: string[] = [];

  constructor(service: Record<string, unknown>) {
    super();
    (this as any).commentService = { assertTaskExists: vi.fn().mockResolvedValue(undefined), ...service };
  }

  protected async authenticate(req: NextRequest) {
    return Object.assign(req, { context: { tenant: 'test-tenant', userId: 'user-1', user: { user_id: 'user-1', user_type: 'internal' } } }) as AuthenticatedApiRequest;
  }

  protected async checkPermission(_req: AuthenticatedApiRequest, action: string) {
    this.permissionChecks.push(action);
  }
}

function request(method: string, path: string, body?: unknown) {
  return new NextRequest(`http://localhost${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const base = `/api/v1/projects/tasks/${taskId}/comments`;

describe('project task comment routes', () => {
  it('lists comments in the documented resource shape behind project_task:read', async () => {
    const list = vi.fn().mockResolvedValue([resource]);
    const controller = new TestController({ listComments: list });

    const response = await controller.list()(request('GET', base));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: [resource] });
    expect(list).toHaveBeenCalledWith(taskId, expect.objectContaining({ tenant: 'test-tenant' }));
    expect(controller.permissionChecks).toEqual(['read']);
  });

  it('answers 404 when the task does not exist', async () => {
    const list = vi.fn();
    const controller = new TestController({ listComments: list, assertTaskExists: vi.fn().mockRejectedValue(new NotFoundError('Task not found')) });

    const response = await controller.list()(request('GET', base));

    expect(response.status).toBe(404);
    expect(list).not.toHaveBeenCalled();
  });

  it('creates a comment and validates the note and parent id', async () => {
    const create = vi.fn().mockResolvedValue(resource);
    const controller = new TestController({ createComment: create });

    const ok = await controller.create()(request('POST', base, { note: resource.note, parent_comment_id: null }));
    expect(ok.status).toBe(201);
    expect(create).toHaveBeenCalledWith(taskId, { note: resource.note, parent_comment_id: null }, expect.anything());

    const blank = await controller.create()(request('POST', base, { note: '   ' }));
    expect(blank.status).toBe(400);
    const badParent = await controller.create()(request('POST', base, { note: 'x', parent_comment_id: 'nope' }));
    expect(badParent.status).toBe(400);
    const unknownKey = await controller.create()(request('POST', base, { note: 'x', is_internal: true }));
    expect(unknownKey.status).toBe(400);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('returns 404 from update and delete when the comment is not on this task', async () => {
    const update = vi.fn().mockRejectedValue(new NotFoundError('Comment not found'));
    const remove = vi.fn().mockRejectedValue(new NotFoundError('Comment not found'));
    const controller = new TestController({ updateComment: update, deleteComment: remove });

    const updated = await controller.update()(request('PUT', `${base}/${commentId}`, { note: 'edited' }));
    expect(updated.status).toBe(404);
    expect(update).toHaveBeenCalledWith(taskId, commentId, { note: 'edited' }, expect.anything());

    const deleted = await controller.delete()(request('DELETE', `${base}/${commentId}`));
    expect(deleted.status).toBe(404);
    expect(remove).toHaveBeenCalledWith(taskId, commentId, expect.anything());
  });

  it('deletes with 204 and rejects a malformed comment id before the service', async () => {
    const remove = vi.fn().mockResolvedValue(undefined);
    const controller = new TestController({ deleteComment: remove });

    expect((await controller.delete()(request('DELETE', `${base}/${commentId}`))).status).toBe(204);
    expect((await controller.delete()(request('DELETE', `${base}/not-a-uuid`))).status).toBe(400);
    expect(remove).toHaveBeenCalledTimes(1);
  });

  it('toggles reactions and validates the emoji', async () => {
    const toggleReaction = vi.fn().mockResolvedValue({ added: true, reactions: resource.reactions, reaction_user_names: resource.reaction_user_names });
    const controller = new TestController({ toggleReaction });

    const ok = await controller.toggleReaction()(request('POST', `${base}/${commentId}/reactions`, { emoji: '👍' }));
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ data: { added: true, reactions: resource.reactions, reaction_user_names: resource.reaction_user_names } });
    expect(toggleReaction).toHaveBeenCalledWith(taskId, commentId, '👍', expect.anything());

    const empty = await controller.toggleReaction()(request('POST', `${base}/${commentId}/reactions`, { emoji: '' }));
    expect(empty.status).toBe(400);
    const long = await controller.toggleReaction()(request('POST', `${base}/${commentId}/reactions`, { emoji: 'x'.repeat(51) }));
    expect(long.status).toBe(400);
    expect(toggleReaction).toHaveBeenCalledTimes(1);
  });

  it('documents all five routes', () => {
    const registry = createRegistry();
    registerProjectRoutes(registry, { ErrorResponse: zOpenApi.object({ error: zOpenApi.any() }) });
    const document = registry.buildDocument({ title: 'Projects API Test', version: '1.0.0', edition: 'ce' });
    const collection = document.paths?.[`/api/v1/projects/tasks/{taskId}/comments`];
    const item = document.paths?.[`/api/v1/projects/tasks/{taskId}/comments/{commentId}`];
    const reactions = document.paths?.[`/api/v1/projects/tasks/{taskId}/comments/{commentId}/reactions`];
    expect(collection?.get?.summary).toBe('List project task comments');
    expect(collection?.post?.summary).toBe('Add a project task comment');
    expect(item?.put?.summary).toBe('Edit a project task comment');
    expect(item?.delete?.summary).toBe('Delete a project task comment');
    expect(reactions?.post?.summary).toBe('Toggle a reaction on a project task comment');
  });
});

describe('ProjectTaskCommentService shaping', () => {
  it('maps the camelCase service row to the snake_case resource with reactions attached', () => {
    const service = new ProjectTaskCommentService();
    const shaped = (service as any).shape(
      {
        taskCommentId: commentId,
        taskId,
        threadId: resource.thread_id,
        parentCommentId: null,
        userId: resource.user_id,
        authorType: 'internal',
        note: resource.note,
        markdownContent: 'hi',
        createdAt: resource.created_at,
        updatedAt: undefined,
        editedAt: undefined,
        deletedAt: null,
        tenant: 'test-tenant',
        firstName: 'Sam',
        lastName: 'Lee',
        email: 'sam@acme.test',
        avatarUrl: null,
      },
      { [commentId]: resource.reactions },
      resource.reaction_user_names,
    );
    expect(shaped).toEqual(resource);
  });
});
