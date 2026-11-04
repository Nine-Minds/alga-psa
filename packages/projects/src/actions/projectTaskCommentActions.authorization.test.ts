import { beforeEach, describe, expect, it, vi } from 'vitest';

// Finding 1 & 2 at the action layer: with the real authorization helper in place, a caller who is
// denied (read-only permission, or no access to the parent project) must never reach the service.
const state = vi.hoisted(() => ({
  perms: new Set<string>(),
  allowedProjects: new Set<string>(),
}));
const service = vi.hoisted(() => ({
  listTaskCommentsWithDb: vi.fn(async () => [{ note: 'secret', email: 'a@b.c' }]),
  createTaskCommentWithDb: vi.fn(async () => 'new'),
  updateTaskCommentWithDb: vi.fn(async () => undefined),
  deleteTaskCommentWithDb: vi.fn(async () => undefined),
  countTaskCommentsWithDb: vi.fn(async () => 3),
  countTaskCommentsBatchWithDb: vi.fn(async () => ({})),
}));

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: async () => ({ knex: {} }),
  withTransaction: async (_db: unknown, fn: (trx: unknown) => unknown) => fn({}),
  tenantDb: () => ({
    tenantJoin: () => undefined,
    table: (name: string) => {
      let ids: string[] = [];
      const q: any = {
        whereIn: (_c: string, v: string[]) => { ids = v; return q; },
        select: async () => name === 'project_tasks'
          ? [{ task_id: 'T1', project_id: 'P1' }, { task_id: 'T2', project_id: 'P2' }].filter((r) => ids.includes(r.task_id))
          : [{ task_comment_id: 'C2', task_id: 'T2', user_id: 'other' }].filter((r) => ids.includes(r.task_comment_id)),
      };
      return q;
    },
  }),
}));
vi.mock('@alga-psa/auth', () => ({
  withAuth: (a: any) => (...args: any[]) => a({ user_id: 'me', user_type: 'internal', tenant: 't1' }, { tenant: 't1' }, ...args),
  getApiKeyUserOverride: () => null,
  getSession: async () => null,
}));
vi.mock('@alga-psa/auth/rbac', () => ({
  hasPermission: async (_u: unknown, r: string, a: string) => state.perms.has(`${r}:${a}`),
}));
const serves = vi.hoisted(() => vi.fn(async () => ({ served: false })));
vi.mock('@alga-psa/core/capability', () => ({ serves }));
vi.mock('@alga-psa/ui/lib/errorHandling', () => ({
  actionError: (message: string) => ({ error: message }),
  permissionError: (message: string) => ({ permissionError: message }),
}));
vi.mock('../models/project', () => ({
  default: { getById: async (_t: unknown, _n: string, id: string) => ({ project_id: id }) },
}));
vi.mock('../lib/projectReadAuthorization', () => ({
  createProjectReadAuthorizer: async () => async (p: { project_id: string }) => state.allowedProjects.has(p.project_id),
}));
vi.mock('../lib/taskComments/taskCommentService', () => service);

import { createTaskComment, deleteTaskComment, getTaskComments, getTaskCommentCount, getTaskCommentCountsBatch, updateTaskComment } from './projectTaskCommentActions';

beforeEach(() => {
  vi.clearAllMocks();
  state.perms = new Set(['project_task:read', 'project_task:create', 'project_task:update', 'project_task:delete']);
  state.allowedProjects = new Set(['P1']);
});

describe('task comment actions enforce the shared authorization boundary', () => {
  it('finding 1: getTaskComments for a task in a forbidden project returns an error and no comment data', async () => {
    const result = await getTaskComments('T2');
    expect(Array.isArray(result)).toBe(false);
    expect(JSON.stringify(result)).not.toContain('secret');
    expect(service.listTaskCommentsWithDb).not.toHaveBeenCalled();
    expect(await getTaskCommentCount('T2')).not.toBe(3);
  });

  it('probing: forbidden and unknown task ids return the same result', async () => {
    expect(await getTaskComments('T2')).toEqual(await getTaskComments('missing'));
  });

  it('finding 2: read-only permission cannot create, update or delete', async () => {
    state.perms = new Set(['project_task:read']);
    const results = [
      await createTaskComment({ taskId: 'T1', note: 'x' } as any),
      await updateTaskComment('C2', { note: 'x' }),
      await deleteTaskComment('C2'),
    ];
    for (const r of results) expect(r).toHaveProperty('permissionError');
    expect(service.createTaskCommentWithDb).not.toHaveBeenCalled();
    expect(service.updateTaskCommentWithDb).not.toHaveBeenCalled();
    expect(service.deleteTaskCommentWithDb).not.toHaveBeenCalled();
  });

  it('finding 2: write permission without access to the parent project is rejected', async () => {
    await createTaskComment({ taskId: 'T2', note: 'x' } as any);
    await updateTaskComment('C2', { note: 'x' });
    await deleteTaskComment('C2');
    expect(service.createTaskCommentWithDb).not.toHaveBeenCalled();
    expect(service.updateTaskCommentWithDb).not.toHaveBeenCalled();
    expect(service.deleteTaskCommentWithDb).not.toHaveBeenCalled();
  });

  it('positive path: an authorized user reads and creates on an accessible task', async () => {
    expect(await getTaskComments('T1')).toHaveLength(1);
    expect(await createTaskComment({ taskId: 'T1', note: 'x' } as any)).toBe('new');
  });

  it('batch counts: a caller without project_task:read is rejected before the co-managed path (serves) is consulted', async () => {
    state.perms = new Set();
    const result = await getTaskCommentCountsBatch(['T1']);
    expect(result).toHaveProperty('permissionError');
    expect(serves).not.toHaveBeenCalled();
    expect(service.countTaskCommentsBatchWithDb).not.toHaveBeenCalled();
  });

  it('batch counts: only tasks in accessible projects are counted', async () => {
    await getTaskCommentCountsBatch(['T1', 'T2']);
    expect(service.countTaskCommentsBatchWithDb).toHaveBeenCalledWith(expect.anything(), 't1', ['T1']);
  });
});
