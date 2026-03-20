import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  tenantId: 'tenant-123',
  userId: 'user-123',
  createTenantKnex: vi.fn(),
  withTransaction: vi.fn(),
  getTaskById: vi.fn(),
  completeTask: vi.fn(),
  addTaskHistory: vi.fn(),
  getTasksAssignedToUser: vi.fn(),
  getTasksAssignedToRoles: vi.fn(),
  getFormRegistry: vi.fn(),
  revalidatePath: vi.fn(),
  trx: {} as any,
}));

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: state.createTenantKnex,
  withTransaction: state.withTransaction,
}));

vi.mock('@alga-psa/auth', () => ({
  withAuth: (action: (user: any, ctx: { tenant: string }, ...args: any[]) => Promise<any>) =>
    async (...args: any[]) => action(
      {
        user_id: state.userId,
        tenant: state.tenantId,
        roles: [{ role_id: 'role-1' }],
      },
      { tenant: state.tenantId },
      ...args
    ),
}));

vi.mock('@shared/task-inbox', () => ({
  getFormRegistry: state.getFormRegistry,
}));

vi.mock('@alga-psa/workflows/persistence', () => ({
  WorkflowTaskModel: {
    getTaskById: state.getTaskById,
    completeTask: state.completeTask,
    addTaskHistory: state.addTaskHistory,
    getTasksAssignedToUser: state.getTasksAssignedToUser,
    getTasksAssignedToRoles: state.getTasksAssignedToRoles,
  },
  WorkflowTaskStatus: {
    PENDING: 'pending',
    CLAIMED: 'claimed',
    COMPLETED: 'completed',
    CANCELED: 'canceled',
    EXPIRED: 'expired',
  },
}));

vi.mock('next/cache', () => ({
  revalidatePath: state.revalidatePath,
}));

const { dismissTask, getUserTasks, submitTaskForm } = await import(
  '../../../../packages/workflows/src/actions/workflow-actions/taskInboxActions'
);

describe('workflow task inbox actions', () => {
  beforeEach(() => {
    state.trx = {};
    state.createTenantKnex.mockReset();
    state.withTransaction.mockReset();
    state.getTaskById.mockReset();
    state.completeTask.mockReset();
    state.addTaskHistory.mockReset();
    state.getTasksAssignedToUser.mockReset();
    state.getTasksAssignedToRoles.mockReset();
    state.getFormRegistry.mockReset();
    state.revalidatePath.mockReset();

    state.createTenantKnex.mockResolvedValue({ knex: state.trx, tenant: state.tenantId });
    state.withTransaction.mockImplementation(async (_knex: unknown, callback: (trx: unknown) => Promise<unknown>) => callback(state.trx));
  });

  it('submits tenant task forms through the workflow persistence surface and records completion history', async () => {
    const validateFormData = vi.fn(async () => ({ valid: true, errors: [] }));
    state.getFormRegistry.mockReturnValue({ validateFormData });

    const taskDefinition = {
      task_definition_id: 'tenant-definition-1',
      form_id: 'tenant-form-1',
    };
    state.trx = Object.assign(
      vi.fn((table: string) => {
        if (table === 'workflow_task_definitions') {
          return {
            where: vi.fn(() => ({
              first: vi.fn(async () => taskDefinition),
            })),
          };
        }
        throw new Error(`Unexpected table lookup: ${table}`);
      }),
      { fn: { now: () => new Date('2026-03-13T12:00:00.000Z') } }
    );
    state.getTaskById.mockResolvedValue({
      task_id: 'task-1',
      task_definition_type: 'tenant',
      tenant_task_definition_id: taskDefinition.task_definition_id,
      status: 'pending',
    });

    const result = await submitTaskForm({
      taskId: 'task-1',
      formData: { approved: true },
      comments: 'looks good',
    });

    expect(result).toEqual({ success: true });
    expect(validateFormData).toHaveBeenCalledWith(state.trx, state.tenantId, 'tenant-form-1', { approved: true });
    expect(state.completeTask).toHaveBeenCalledWith(
      state.trx,
      state.tenantId,
      'task-1',
      { approved: true, __comments: 'looks good' },
      state.userId
    );
    expect(state.addTaskHistory).toHaveBeenCalledWith(
      state.trx,
      state.tenantId,
      expect.objectContaining({
        task_id: 'task-1',
        action: 'complete',
        from_status: 'pending',
        to_status: 'completed',
        user_id: state.userId,
        details: {
          formData: { approved: true, __comments: 'looks good' },
        },
      })
    );
  });

  it('combines direct and role-assigned tasks without duplicates and paginates the sorted inbox view', async () => {
    state.getTasksAssignedToUser.mockResolvedValue([
      {
        task_id: 'task-a',
        execution_id: 'exec-a',
        title: 'Task A',
        description: 'direct assignment',
        status: 'pending',
        priority: 'medium',
        due_date: '2026-03-16T00:00:00.000Z',
        assigned_roles: [],
        assigned_users: [state.userId],
        context_data: { source: 'direct' },
        created_at: '2026-03-12T10:00:00.000Z',
        created_by: 'creator-a',
      },
      {
        task_id: 'task-b',
        execution_id: 'exec-b',
        title: 'Task B',
        description: 'direct assignment without due date',
        status: 'claimed',
        priority: 'low',
        due_date: null,
        assigned_roles: [],
        assigned_users: [state.userId],
        context_data: { source: 'direct' },
        created_at: '2026-03-13T09:00:00.000Z',
        created_by: 'creator-b',
      },
    ]);
    state.getTasksAssignedToRoles.mockResolvedValue([
      {
        task_id: 'task-a',
        execution_id: 'exec-a',
        title: 'Task A duplicate',
        description: 'role duplicate',
        status: 'pending',
        priority: 'medium',
        due_date: '2026-03-16T00:00:00.000Z',
        assigned_roles: ['role-1'],
        assigned_users: [state.userId],
        context_data: { source: 'role' },
        created_at: '2026-03-12T10:00:00.000Z',
        created_by: 'creator-a',
      },
      {
        task_id: 'task-c',
        execution_id: 'exec-c',
        title: 'Task C',
        description: 'role assignment',
        status: 'pending',
        priority: 'high',
        due_date: '2026-03-14T00:00:00.000Z',
        assigned_roles: ['role-1'],
        assigned_users: [],
        context_data: { source: 'role' },
        created_at: '2026-03-11T12:00:00.000Z',
        created_by: 'creator-c',
      },
    ]);

    const result = await getUserTasks({ page: 1, pageSize: 2 });

    expect(state.getTasksAssignedToUser).toHaveBeenCalledWith(
      state.trx,
      state.tenantId,
      state.userId,
      ['pending', 'claimed']
    );
    expect(state.getTasksAssignedToRoles).toHaveBeenCalledWith(
      state.trx,
      state.tenantId,
      ['role-1'],
      ['pending', 'claimed']
    );
    expect(result.total).toBe(3);
    expect(result.totalPages).toBe(2);
    expect(result.tasks.map((task) => task.taskId)).toEqual(['task-c', 'task-a']);
    expect(result.tasks[0]).toMatchObject({
      taskId: 'task-c',
      status: 'pending',
      formId: '',
    });
  });

  it('dismisses pending tasks via the workflow persistence surface and revalidates the inbox route', async () => {
    state.getTaskById.mockResolvedValue({
      task_id: 'task-9',
      status: 'pending',
      claimed_by: null,
    });

    const result = await dismissTask('task-9');

    expect(result).toEqual({ success: true });
    expect(state.completeTask).toHaveBeenCalledWith(
      state.trx,
      state.tenantId,
      'task-9',
      expect.objectContaining({
        dismissed: true,
        dismissedBy: state.userId,
        reason: 'dismissed_by_user',
      }),
      state.userId
    );
    expect(state.addTaskHistory).toHaveBeenCalledWith(
      state.trx,
      state.tenantId,
      expect.objectContaining({
        task_id: 'task-9',
        action: 'dismiss',
        from_status: 'pending',
        to_status: 'completed',
        user_id: state.userId,
      })
    );
    expect(state.revalidatePath).toHaveBeenCalledWith('/msp/user-activities');
  });
});
