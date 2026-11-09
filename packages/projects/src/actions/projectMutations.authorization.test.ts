import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  projectMutation: vi.fn(),
  projectUpdate: vi.fn(),
  projectDelete: vi.fn(),
  taskUpdate: vi.fn(),
  authorizationMode: 'write-denied' as 'write-denied' | 'read-denied',
  task: { task_id: 'T1', phase_id: 'PH1', project_id: 'P1' },
}));

vi.mock('@alga-psa/auth', () => ({
  withAuth: (action: (...args: any[]) => unknown) => (...args: any[]) =>
    action({ user_id: 'user-1', user_type: 'internal', roles: ['role-1'] }, { tenant: 'tenant-1' }, ...args),
  withOptionalAuth: (action: (...args: any[]) => unknown) => action,
  localizeActionError: (error: unknown) => error,
}));

vi.mock('@alga-psa/auth/rbac', () => ({
  checkPermission: async () => null,
  hasPermission: async () => true,
}));

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: async () => ({ knex: {} }),
  withTransaction: async (_db: unknown, work: (trx: unknown) => unknown) => work({}),
  registerAfterCommit: () => undefined,
  tenantDb: () => ({
    table: () => ({
      where() { return this; },
      first: async () => ({ project_id: 'P1' }),
      select: async () => [],
    }),
  }),
}));

vi.mock('@alga-psa/core/server', () => ({
  deleteEntityWithValidation: async (
    _entity: string,
    _id: string,
    _db: unknown,
    tenant: string,
    authorizeAndDelete: (trx: unknown, tenant: string) => Promise<void>,
  ) => authorizeAndDelete({}, tenant),
}));

vi.mock('../lib/projectReadAuthorization', () => ({
  assertProjectMutationAllowed: async (_trx: unknown, _tenant: string, _user: unknown, projectId: string, action: string) => {
    return state.projectMutation(_trx, _tenant, _user, projectId, action);
  },
  assertProjectReadAllowed: async () => ({ project_id: 'P1' }),
  createProjectReadAuthorizer: async () => async () => true,
}));

vi.mock('../models/project', () => ({
  default: {
    update: state.projectUpdate,
    delete: state.projectDelete,
    getById: async () => ({ project_id: 'P1' }),
  },
}));

vi.mock('../models/projectTask', () => ({
  default: {
    getTaskById: async (_trx: unknown, _tenant: string, taskId: string) => taskId === 'missing' ? null : state.task,
    updateTask: state.taskUpdate,
  },
}));

import { deleteProject, updateProject } from './projectActions';
import { updateTaskWithChecklist } from './projectTaskActions';

beforeEach(() => {
  vi.clearAllMocks();
  state.projectMutation.mockImplementation(async (_trx, _tenant, _user, projectId, action) => {
    if (projectId === 'missing') {
      throw new Error('Project not found');
    }
    if (state.authorizationMode === 'read-denied') {
      throw new Error('Permission denied: Cannot read project');
    }
    throw new Error(`Permission denied: Cannot ${action} project`);
  });
  state.authorizationMode = 'write-denied';
  state.task = { task_id: 'T1', phase_id: 'PH1', project_id: 'P1' };
});

describe('project mutation actions enforce record-level write authorization', () => {
  it('blocks a project update before writing when project:update scope denies the project', async () => {
    const result = await updateProject('P1', {});

    expect(result).toHaveProperty('permissionError');
    expect(state.projectMutation).toHaveBeenCalledWith(expect.anything(), 'tenant-1', expect.anything(), 'P1', 'update');
    expect(state.projectUpdate).not.toHaveBeenCalled();
  });

  it('blocks a child task update before writing when its parent project denies project:update scope', async () => {
    const result = await updateTaskWithChecklist('T1', { task_name: 'Changed' } as never);

    expect(result).toHaveProperty('permissionError');
    expect(state.projectMutation).toHaveBeenCalledWith(expect.anything(), 'tenant-1', expect.anything(), 'P1', 'update');
    expect(state.taskUpdate).not.toHaveBeenCalled();
  });

  it('checks project:delete scope and blocks deletion before removing project data', async () => {
    const result = await deleteProject('P1');

    expect(result).toMatchObject({ success: false, message: 'Permission denied: Cannot delete project' });
    expect(state.projectMutation).toHaveBeenCalledWith(expect.anything(), 'tenant-1', expect.anything(), 'P1', 'delete');
    expect(state.projectDelete).not.toHaveBeenCalled();
  });

  it('returns the same public result for unreadable and nonexistent projects and tasks', async () => {
    state.authorizationMode = 'read-denied';

    const unreadableProjectUpdate = await updateProject('P1', {});
    const missingProjectUpdate = await updateProject('missing', {});
    expect(unreadableProjectUpdate).toEqual(missingProjectUpdate);
    expect(unreadableProjectUpdate).toMatchObject({ actionError: 'Project not found' });

    const unreadableProjectDelete = await deleteProject('P1');
    const missingProjectDelete = await deleteProject('missing');
    expect(unreadableProjectDelete).toEqual(missingProjectDelete);
    expect(unreadableProjectDelete).toMatchObject({ success: false, message: 'Project not found' });

    const unreadableTaskUpdate = await updateTaskWithChecklist('T1', { task_name: 'Changed' } as never);
    const missingTaskUpdate = await updateTaskWithChecklist('missing', { task_name: 'Changed' } as never);
    expect(unreadableTaskUpdate).toEqual(missingTaskUpdate);
    expect(unreadableTaskUpdate).toMatchObject({ actionError: 'Task not found' });

    expect(state.projectUpdate).not.toHaveBeenCalled();
    expect(state.projectDelete).not.toHaveBeenCalled();
    expect(state.taskUpdate).not.toHaveBeenCalled();
  });
});
