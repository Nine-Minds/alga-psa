import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  decision: { allowed: true, redactedFields: [] as string[] },
  taskName: 'Map New Areas',
}));

vi.mock('@alga-psa/auth', () => ({ withAuth: (fn: any) => (...args: any[]) => fn({ user_id: 'u1', user_type: 'internal' }, { tenant: 't1' }, ...args) }));
vi.mock('@alga-psa/auth/rbac', () => ({ hasPermission: async () => true }));
vi.mock('@alga-psa/db', () => {
  const raw = (sql: string, args?: any[]) => ({ sql, args });
  const query = (table: string) => {
    let selection: any[] = [];
    const q: any = new Proxy({}, { get(_target, prop) {
      if (prop === 'then') return (resolve: any) => Promise.resolve(rows(table, selection)).then(resolve);
      if (prop === 'select') return (...columns: any[]) => { selection = columns; return q; };
      if (prop === 'first') return async () => rows(table, selection)[0];
      return () => q;
    }});
    return q;
  };
  const rows = (table: string, selection: any[]) => {
    if (table === 'project_tasks as pt') return [{ project_id: 'project1' }];
    if (table === 'project_phases') return [{ phase_id: 'ph1' }];
    if (table === 'project_tasks') {
      const nameMask = selection.flat().find((column) => column?.sql?.includes('as task_name'));
      return [{ tenant: 't1', task_id: 'task1', phase_id: 'ph1', task_name: nameMask?.args?.[0] ?? state.taskName, order_key: 'a' }];
    }
    if (table === 'project_task_dependencies as ptd') {
      const masked = selection.flat().find((column) => column?.sql?.includes('as predecessor_task_name'));
      return [{ predecessor_task_id: 'pred', successor_task_id: 'task1', predecessor_task_name: masked?.args?.[0] ?? 'Hidden Dependency', predecessor_wbs_code: '1' }];
    }
    return [];
  };
  return {
    createTenantKnex: async () => ({ knex: {} }),
    withTransaction: async (_db: any, fn: any) => fn({ raw }),
    tenantDb: () => ({ table: query, tenantJoin: () => undefined }),
  };
});
vi.mock('../models/project', () => ({ default: { getById: async (_trx: any, _tenant: string, id: string) => ({ project_id: id }) } }));
vi.mock('../lib/projectReadAuthorization', () => ({ createProjectReadDecider: async () => async () => state.decision }));
vi.mock('../models/projectTask', () => ({ default: { getTaskResourcesForTasks: async () => [] } }));
vi.mock('@alga-psa/tags/actions/tagActions', () => ({ findTagsByEntityIds: async () => [], bulkApplyTagsToEntities: async () => [] }));
vi.mock('@alga-psa/tags/actions/tagActionErrors', () => ({ isTagActionError: () => false }));
vi.mock('next/cache', () => ({ revalidatePath: () => undefined }));

import { getProjectTaskData, getTaskById } from './projectTaskActions';

beforeEach(() => {
  state.decision = { allowed: true, redactedFields: [] };
  state.taskName = 'Map New Areas';
});

describe('getProjectTaskData project redactions', () => {
  it('masks task names and dependency aliases for the board projection', async () => {
    state.decision = { allowed: true, redactedFields: ['task_name'] };
    const result: any = await getProjectTaskData('project1');
    expect(result.tasks[0].task_name).not.toBe('Map New Areas');
    expect(result.taskDependencies.task1.predecessors[0].predecessor_task_name).not.toBe('Hidden Dependency');
    expect(result.taskDependencies.task1.predecessors[0].predecessor_task.task_name).not.toBe('Hidden Dependency');
  });

  it('denies a project read before returning task data', async () => {
    state.decision = { allowed: false, redactedFields: [] };
    const result = await getProjectTaskData('project1');
    expect(JSON.stringify(result)).not.toContain('Map New Areas');
    expect(result).toHaveProperty('permissionError');
  });

  it('preserves populated names for unrestricted readers', async () => {
    const result: any = await getProjectTaskData('project1');
    expect(result.tasks[0].task_name).toBe('Map New Areas');
    expect(result.taskDependencies.task1.predecessors[0].predecessor_task_name).toBe('Hidden Dependency');
  });

  it('keeps the drawer task reader masked when ProjectDetail reopens a task by id', async () => {
    state.decision = { allowed: true, redactedFields: ['task_name'] };
    const result: any = await getTaskById('task1');
    expect(result.task_name).not.toBe('Map New Areas');
  });
});
