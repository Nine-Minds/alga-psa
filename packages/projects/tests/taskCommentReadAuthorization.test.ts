import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  hasPermission: vi.fn(),
  listTaskCommentsWithDb: vi.fn(),
}));

vi.mock('@alga-psa/auth', () => ({
  withAuth: (action: any) => (...args: any[]) =>
    action({ user_id: 'user-1', tenant: 'tenant-1', user_type: 'internal' }, { tenant: 'tenant-1' }, ...args),
}));
vi.mock('@alga-psa/auth/rbac', () => ({ hasPermission: mocks.hasPermission }));
vi.mock('@alga-psa/db', () => ({
  createTenantKnex: vi.fn(async () => ({ knex: {}, tenant: 'tenant-1' })),
  // getTaskComments runs inside withTaskCommentAccess: one transaction resolving task-1 to its project.
  withTransaction: async (_db: unknown, fn: (trx: unknown) => unknown) => fn({}),
  tenantDb: () => ({
    tenantJoin: () => undefined,
    table: () => {
      const q: any = {
        whereIn: () => q,
        select: async () => [{ task_id: 'task-1', project_id: 'project-1' }],
      };
      return q;
    },
  }),
}));
vi.mock('../src/models/project', () => ({
  default: { getById: async (_t: unknown, _tenant: string, id: string) => ({ project_id: id }) },
}));
vi.mock('../src/lib/projectReadAuthorization', () => ({
  createProjectReadAuthorizer: async () => async () => true,
}));
vi.mock('../src/lib/taskComments/taskCommentService', () => ({
  countTaskCommentsBatchWithDb: vi.fn(),
  countTaskCommentsWithDb: vi.fn(),
  createTaskCommentWithDb: vi.fn(),
  deleteTaskCommentWithDb: vi.fn(),
  listTaskCommentsWithDb: mocks.listTaskCommentsWithDb,
  updateTaskCommentWithDb: vi.fn(),
}));

import { getTaskComments } from '../src/actions/projectTaskCommentActions';

describe('getTaskComments read authorization', () => {
  beforeEach(() => {
    mocks.hasPermission.mockReset();
    mocks.listTaskCommentsWithDb.mockReset();
  });

  it('returns a permission error and never reads comments without project_task:read', async () => {
    mocks.hasPermission.mockResolvedValue(false);
    mocks.listTaskCommentsWithDb.mockResolvedValue([{ task_comment_id: 'c1', note: 'internal discussion' }]);

    const result = await (getTaskComments as any)('task-1');

    expect(result).toMatchObject({ permissionError: expect.stringContaining('Permission denied') });
    expect(mocks.listTaskCommentsWithDb).not.toHaveBeenCalled();
  });

  it('returns the comments when the caller has project_task:read', async () => {
    const comments = [{ task_comment_id: 'c1', note: 'hello' }];
    mocks.hasPermission.mockResolvedValue(true);
    mocks.listTaskCommentsWithDb.mockResolvedValue(comments);

    const result = await (getTaskComments as any)('task-1');

    expect(mocks.hasPermission).toHaveBeenCalledWith(expect.objectContaining({ user_id: 'user-1' }), 'project_task', 'read', expect.anything());
    expect(result).toEqual(comments);
  });
});
