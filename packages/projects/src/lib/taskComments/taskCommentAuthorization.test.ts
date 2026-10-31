import { beforeEach, describe, expect, it, vi } from 'vitest';

// Fixture: project P1 is accessible to the caller, P2 is not. Tasks T1 (P1), T2 (P2). Comments C1 (by me, T1), C2 (by other, T1), C3 (other, T2).
const state = vi.hoisted(() => ({
  perms: new Set<string>(),
  allowedProjects: new Set<string>(),
  tasks: [] as { task_id: string; project_id: string }[],
  comments: [] as { task_comment_id: string; task_id: string; user_id: string }[],
}));

vi.mock('@alga-psa/db', () => ({
  withTransaction: async (_db: unknown, fn: (trx: unknown) => unknown) => fn({ isTransaction: true }),
  tenantDb: () => ({
    tenantJoin: () => undefined,
    table: (name: string) => {
      const rows = name === 'project_tasks' ? state.tasks : state.comments;
      const key = name === 'project_tasks' ? 'project_tasks.task_id' : 'task_comment_id';
      const field = name === 'project_tasks' ? 'task_id' : 'task_comment_id';
      let ids: string[] = [];
      const q: any = {
        whereIn: (_col: string, values: string[]) => { expect(_col).toBe(key); ids = values; return q; },
        select: async () => rows.filter((r: any) => ids.includes(r[field])),
      };
      return q;
    },
  }),
}));
vi.mock('@alga-psa/auth/rbac', () => ({
  hasPermission: async (_u: unknown, resource: string, action: string) => state.perms.has(`${resource}:${action}`),
}));
vi.mock('../../models/project', () => ({
  default: { getById: async (_t: unknown, _tenant: string, id: string) => ({ project_id: id }) },
}));
vi.mock('../projectReadAuthorization', () => ({
  createProjectReadAuthorizer: async () => async (p: { project_id: string }) => state.allowedProjects.has(p.project_id),
}));

import { withTaskCommentAccess, withTaskCommentBatchReadAccess } from './taskCommentAuthorization';

const me = { user_id: 'me', tenant: 't1', user_type: 'internal' } as any;
const run = (target: any, action: any, work = vi.fn(async () => 'ok')) =>
  withTaskCommentAccess({} as any, 't1', me, target, action, work as any).then((r) => ({ r, work }));

beforeEach(() => {
  state.perms = new Set(['project_task:read', 'project_task:create', 'project_task:update', 'project_task:delete']);
  state.allowedProjects = new Set(['P1']);
  state.tasks = [{ task_id: 'T1', project_id: 'P1' }, { task_id: 'T2', project_id: 'P2' }];
  state.comments = [
    { task_comment_id: 'C1', task_id: 'T1', user_id: 'me' },
    { task_comment_id: 'C2', task_id: 'T1', user_id: 'other' },
    { task_comment_id: 'C3', task_id: 'T2', user_id: 'other' },
  ];
});

describe('withTaskCommentAccess', () => {
  it('finding 1: read of a task in a project without record access is rejected before work runs', async () => {
    const work = vi.fn(async () => 'bodies');
    await expect(run({ taskId: 'T2' }, 'read', work)).rejects.toThrow('Task not found');
    expect(work).not.toHaveBeenCalled();
  });

  it('probing: unknown and forbidden task ids produce the same error', async () => {
    const forbidden = await run({ taskId: 'T2' }, 'read').catch((e) => e.message);
    const unknown = await run({ taskId: 'nope' }, 'read').catch((e) => e.message);
    expect(forbidden).toBe(unknown);
    const fc = await run({ taskCommentId: 'C3' }, 'update').catch((e) => e.message);
    const uc = await run({ taskCommentId: 'nope' }, 'update').catch((e) => e.message);
    expect(fc).toBe(uc);
  });

  it.each(['create', 'update', 'delete'] as const)('finding 2: read-only permission cannot %s', async (action) => {
    state.perms = new Set(['project_task:read']);
    const target = action === 'create' ? { taskId: 'T1' } : { taskCommentId: 'C1' };
    const work = vi.fn(async () => 'ok');
    await expect(run(target, action, work)).rejects.toThrow(/Permission denied/);
    expect(work).not.toHaveBeenCalled();
  });

  it('finding 2: write permission without access to the parent project is rejected', async () => {
    for (const [target, action] of [[{ taskId: 'T2' }, 'create'], [{ taskCommentId: 'C3' }, 'update'], [{ taskCommentId: 'C3' }, 'delete']] as const) {
      const work = vi.fn(async () => 'ok');
      await expect(run(target, action, work)).rejects.toThrow(/not found/);
      expect(work).not.toHaveBeenCalled();
    }
  });

  it('a read-level record pass does not rescue a caller lacking the coarse permission', async () => {
    state.perms = new Set();
    await expect(run({ taskId: 'T1' }, 'read')).rejects.toThrow(/Permission denied/);
  });

  it('finding 2: non-author without project_task:update cannot edit or delete someone else\'s comment', async () => {
    state.perms = new Set(['project_task:read', 'project_task:delete']);
    await expect(run({ taskCommentId: 'C2' }, 'delete')).rejects.toThrow('You can only delete your own comments');
    state.perms = new Set(['project_task:read']);
    await expect(run({ taskCommentId: 'C2' }, 'update')).rejects.toThrow(/Permission denied/);
  });

  it('author may edit/delete own comment; authorized users keep the positive path', async () => {
    for (const [target, action] of [
      [{ taskId: 'T1' }, 'read'], [{ taskId: 'T1' }, 'create'], [{ taskCommentId: 'C1' }, 'update'],
      [{ taskCommentId: 'C1' }, 'delete'], [{ taskCommentId: 'C2' }, 'react'], [{ taskCommentId: 'C2' }, 'update'],
    ] as const) {
      const { r, work } = await run(target, action);
      expect(r).toBe('ok');
      expect(work).toHaveBeenCalledWith(expect.objectContaining({ projectId: 'P1', taskId: 'T1' }));
    }
  });

  it('client user cannot edit or delete another user\'s comment even with project_task:update', async () => {
    const client = { user_id: 'me', tenant: 't1', user_type: 'client' } as any;
    for (const action of ['update', 'delete'] as const) {
      const work = vi.fn(async () => 'ok');
      await expect(withTaskCommentAccess({} as any, 't1', client, { taskCommentId: 'C2' }, action, work as any))
        .rejects.toThrow(`You can only ${action === 'update' ? 'edit' : 'delete'} your own comments`);
      expect(work).not.toHaveBeenCalled();
    }
    expect(await withTaskCommentAccess({} as any, 't1', client, { taskCommentId: 'C1' }, 'delete', async () => 'ok')).toBe('ok');
  });

  it('author with delete permission only (no project_task:update) can delete own comment', async () => {
    state.perms = new Set(['project_task:read', 'project_task:delete']);
    expect((await run({ taskCommentId: 'C1' }, 'delete')).r).toBe('ok');
  });
});

describe('withTaskCommentBatchReadAccess', () => {
  it('drops tasks and comments in forbidden projects', async () => {
    const seen: string[][] = [];
    await withTaskCommentBatchReadAccess({} as any, 't1', me, { taskIds: ['T1', 'T2', 'nope'] }, 'read', async ({ ids }) => { seen.push(ids); });
    await withTaskCommentBatchReadAccess({} as any, 't1', me, { taskCommentIds: ['C1', 'C3'] }, 'read', async ({ ids }) => { seen.push(ids); });
    expect(seen).toEqual([['T1'], ['C1']]);
  });
  it('requires project_task:read', async () => {
    state.perms = new Set();
    await expect(withTaskCommentBatchReadAccess({} as any, 't1', me, { taskIds: ['T1'] }, 'read', async () => 1)).rejects.toThrow(/Permission denied/);
  });
});
