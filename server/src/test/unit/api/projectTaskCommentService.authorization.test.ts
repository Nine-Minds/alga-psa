import { beforeEach, describe, expect, it, vi } from 'vitest';

// REST boundary: every ProjectTaskCommentService operation must go through withTaskCommentAccess.
const state = vi.hoisted(() => ({
  perms: new Set<string>(),
  allowedProjects: new Set<string>(),
}));
const svc = vi.hoisted(() => ({
  createTaskCommentWithDb: vi.fn(async () => 'C-new'),
  updateTaskCommentWithDb: vi.fn(async () => undefined),
  deleteTaskCommentWithDb: vi.fn(async () => undefined),
  listTaskCommentsWithDb: vi.fn(async () => [] as any[]),
  getTaskCommentsReactionsBatchWithDb: vi.fn(async () => ({ reactions: {}, userNames: {} })),
  toggleTaskCommentReactionWithDb: vi.fn(async () => ({ added: true })),
  getTaskCommentById: vi.fn(async (_t: unknown, _tenant: string, id: string) => ({ task_comment_id: id, task_id: 'T1' })),
}));

vi.mock('@alga-psa/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@alga-psa/db')>()),
  withTransaction: async (_db: unknown, fn: (trx: unknown) => unknown) => fn({}),
  tenantDb: () => ({
    tenantJoin: () => undefined,
    table: (name: string) => {
      let ids: string[] = [];
      const q: any = {
        whereIn: (_c: string, v: string[]) => { ids = v; return q; },
        select: async () => name === 'project_tasks'
          ? [{ task_id: 'T1', project_id: 'P1' }, { task_id: 'T2', project_id: 'P2' }].filter((r) => ids.includes(r.task_id))
          : [
              { task_comment_id: 'C1', task_id: 'T1', user_id: 'user-1' },
              { task_comment_id: 'C2', task_id: 'T2', user_id: 'other' },
            ].filter((r) => ids.includes(r.task_comment_id)),
      };
      return q;
    },
  }),
}));
vi.mock('@alga-psa/auth/rbac', () => ({
  hasPermission: async (_u: unknown, r: string, a: string) => state.perms.has(`${r}:${a}`),
}));
vi.mock('../../../../../packages/projects/src/models/project', () => ({
  default: { getById: async (_t: unknown, _n: string, id: string) => ({ project_id: id }) },
}));
vi.mock('../../../../../packages/projects/src/lib/projectReadAuthorization', () => ({
  createProjectReadAuthorizer: async () => async (p: { project_id: string }) => state.allowedProjects.has(p.project_id),
}));
vi.mock('../../../../../packages/projects/src/lib/taskComments/taskCommentService', () => svc);

import { ProjectTaskCommentService } from '../../../lib/api/services/ProjectTaskCommentService';
import { ForbiddenError, NotFoundError } from '../../../lib/api/middleware/apiMiddleware';

const context = { tenant: 't1', userId: 'user-1', db: {}, user: { user_id: 'user-1', user_type: 'internal', tenant: 't1' } } as any;
const note = { note: 'x' };

beforeEach(() => {
  vi.clearAllMocks();
  state.perms = new Set(['project_task:read', 'project_task:create', 'project_task:update', 'project_task:delete']);
  state.allowedProjects = new Set(['P1']);
});

describe('ProjectTaskCommentService authorization', () => {
  it('(a) read-only callers get Forbidden on create, update and delete and no mutator runs', async () => {
    state.perms = new Set(['project_task:read']);
    const service = new ProjectTaskCommentService();
    await expect(service.createComment('T1', note, context)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(service.updateComment('T1', 'C1', note, context)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(service.deleteComment('T1', 'C1', context)).rejects.toBeInstanceOf(ForbiddenError);
    expect(svc.createTaskCommentWithDb).not.toHaveBeenCalled();
    expect(svc.updateTaskCommentWithDb).not.toHaveBeenCalled();
    expect(svc.deleteTaskCommentWithDb).not.toHaveBeenCalled();
  });

  it('(b) listing a task in a project the authorizer denies is the same 404 as an unknown task', async () => {
    const service = new ProjectTaskCommentService();
    const denied = await service.listComments('T2', context).catch((e) => e);
    const unknown = await service.listComments('missing', context).catch((e) => e);
    expect(denied).toBeInstanceOf(NotFoundError);
    expect(denied.message).toBe('Task not found');
    expect(unknown.message).toBe(denied.message);
    expect(svc.listTaskCommentsWithDb).not.toHaveBeenCalled();
  });

  it('(b) write-permitted callers without access to the parent project cannot touch its comments', async () => {
    const service = new ProjectTaskCommentService();
    await expect(service.createComment('T2', note, context)).rejects.toBeInstanceOf(NotFoundError);
    await expect(service.updateComment('T2', 'C2', note, context)).rejects.toBeInstanceOf(NotFoundError);
    await expect(service.deleteComment('T2', 'C2', context)).rejects.toBeInstanceOf(NotFoundError);
    await expect(service.toggleReaction('T2', 'C2', '👍', context)).rejects.toBeInstanceOf(NotFoundError);
    expect(svc.createTaskCommentWithDb).not.toHaveBeenCalled();
    expect(svc.updateTaskCommentWithDb).not.toHaveBeenCalled();
    expect(svc.deleteTaskCommentWithDb).not.toHaveBeenCalled();
    expect(svc.toggleTaskCommentReactionWithDb).not.toHaveBeenCalled();
  });

  it('(c) an authorized caller can still list, update, delete and react on an accessible task', async () => {
    const service = new ProjectTaskCommentService();
    svc.listTaskCommentsWithDb.mockResolvedValue([{ taskCommentId: 'C1', taskId: 'T1', userId: 'user-1', note: 'x' }]);
    expect(await service.listComments('T1', context)).toHaveLength(1);
    await service.updateComment('T1', 'C1', note, context);
    expect(svc.updateTaskCommentWithDb).toHaveBeenCalledTimes(1);
    await service.deleteComment('T1', 'C1', context);
    expect(svc.deleteTaskCommentWithDb).toHaveBeenCalledTimes(1);
    expect(await service.toggleReaction('T1', 'C1', '👍', context)).toMatchObject({ added: true });
  });
});
