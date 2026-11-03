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
      if (prop === 'first') return async () => table === 'project_tasks'
        ? { phase_name: 'Phase', project_id: 'project1', status_id: 'status1', assigned_to_first_name: null, assigned_to_last_name: null }
        : rows(table, selection)[0];
      return () => q;
    }});
    return q;
  };
  const rows = (table: string, selection: any[]) => {
    if (table === 'project_tasks as pt') return [{ project_id: 'project1' }];
    if (table === 'project_phases') return [{ phase_id: 'ph1', project_id: 'project1', phase_name: 'Phase' }];
    if (table === 'project_tasks') {
      const nameMask = selection.flat().find((column) => column?.sql?.includes('as task_name'));
      const title = nameMask?.args?.[0] ?? state.taskName;
      const descriptionMask = selection.flat().find((column) => column?.args?.includes('description') || column?.sql?.includes('as description'));
      return [
        { tenant: 't1', task_id: 'task1', phase_id: 'ph1', task_name: title, description: descriptionMask ? null : 'Visible body', description_rich_text: descriptionMask ? null : 'Visible rich body', order_key: 'a', wbs_code: '1' },
        { tenant: 't1', task_id: 'pred', phase_id: 'ph1', task_name: title, description: descriptionMask ? null : 'Visible body', description_rich_text: descriptionMask ? null : 'Visible rich body', order_key: 'b', wbs_code: '2' },
        { tenant: 't1', task_id: 'succ', phase_id: 'ph1', task_name: title, description: descriptionMask ? null : 'Visible body', description_rich_text: descriptionMask ? null : 'Visible rich body', order_key: 'c', wbs_code: '3' },
      ];
    }
    if (table === 'project_task_dependencies as ptd') {
      const maskedPred = selection.flat().find((column) => column?.sql?.includes('as predecessor_task_name'));
      const maskedSucc = selection.flat().find((column) => column?.sql?.includes('as successor_task_name'));
      return [{ dependency_id: 'dep1', predecessor_task_id: 'pred', successor_task_id: 'task1',
        predecessor_task_name: maskedPred?.args?.[0] ?? 'Hidden Dependency', successor_task_name: maskedSucc?.args?.[0] ?? 'Hidden Successor',
        predecessor_task_wbs_code: '1', successor_task_wbs_code: '2', predecessor_task_type_key: 'type', successor_task_type_key: 'type' }];
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
vi.mock('../models/projectTask', () => ({ default: {
  getTaskResourcesForTasks: async () => [], getTaskTicketLinksForTasks: async () => [], getTaskChecklistItems: async () => ({}),
  getTaskTicketLinks: async () => [], getTaskResources: async () => [], getChecklistItems: async () => [],
} }));
vi.mock('../models/taskDependency', () => ({ default: { getTaskDependencies: async () => ({
  predecessors: [{ dependency_id: 'dep1', predecessor_task_id: 'pred', successor_task_id: 'task1', dependency_type: 'blocks', lead_lag_days: 0, created_at: new Date(), updated_at: new Date(), predecessor_task_name: 'Hidden Dependency', predecessor_task_wbs_code: '1', predecessor_task_type_key: 'type', predecessor_task: { task_id: 'pred', task_name: 'Hidden Dependency', wbs_code: '1', task_type_key: 'type' } }],
  successors: [{ dependency_id: 'dep2', predecessor_task_id: 'task1', successor_task_id: 'succ', dependency_type: 'blocks', lead_lag_days: 0, created_at: new Date(), updated_at: new Date(), successor_task_name: 'Hidden Successor', successor_task_wbs_code: '3', successor_task_type_key: 'type', successor_task: { task_id: 'succ', task_name: 'Hidden Successor', wbs_code: '3', task_type_key: 'type' } }],
}) } }));
vi.mock('./projectActions', () => ({ getProjectTaskStatuses: async () => [] }));
vi.mock('@alga-psa/tags/actions/tagActions', () => ({ findTagsByEntityIds: async () => [], bulkApplyTagsToEntities: async () => [] }));
vi.mock('@alga-psa/tags/actions/tagActionErrors', () => ({ isTagActionError: () => false }));
vi.mock('next/cache', () => ({ revalidatePath: () => undefined }));

import { getProjectTaskData, getTaskById, getTaskDependencies, getTasksForPhase, getAllProjectTasksForListView, getTaskWithDetails } from './projectTaskActions';

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
    expect(result.taskDependencies.task1.predecessors[0].predecessor_task_name).toBe('Map New Areas');
    expect(result.taskDependencies.task1.predecessors[0].predecessor_task.task_name).toBe('Map New Areas');
  });

  it('keeps the drawer task reader masked when ProjectDetail reopens a task by id', async () => {
    state.decision = { allowed: true, redactedFields: ['task_name'] };
    const result: any = await getTaskById('task1');
    expect(result.task_name).not.toBe('Map New Areas');
  });

  it('projects both dependency directions from authorized task rows for the drawer', async () => {
    state.decision = { allowed: true, redactedFields: ['task_name'] };
    const result: any = await getTaskDependencies('task1');
    expect(result.predecessors[0].predecessor_task_name).not.toBe('Hidden Dependency');
    expect(result.predecessors[0].predecessor_task.task_name).not.toBe('Hidden Dependency');
    expect(result.successors[0].successor_task_name).not.toBe('Hidden Successor');
    expect(result.successors[0].successor_task.task_name).not.toBe('Hidden Successor');
  });

  it('preserves both dependency names for unrestricted reads and denies inaccessible parent tasks', async () => {
    const unrestricted: any = await getTaskDependencies('task1');
    expect(unrestricted.predecessors[0].predecessor_task.task_name).toBe('Map New Areas');
    expect(unrestricted.successors[0].successor_task.task_name).toBe('Map New Areas');

    state.decision = { allowed: false, redactedFields: [] };
    const denied = await getTaskDependencies('task1');
    expect(denied).toHaveProperty('permissionError');
    expect(JSON.stringify(denied)).not.toContain('Hidden Dependency');
  });

  it('masks description fields and suppresses task rows when the shared projection says dropRow', async () => {
    state.decision = { allowed: true, redactedFields: ['description'] };
    const bodyMasked: any = await getProjectTaskData('project1');
    expect(bodyMasked.tasks[0].description).toBeNull();
    expect(bodyMasked.tasks[0].description_rich_text).toBeNull();

    state.decision = { allowed: true, redactedFields: ['task_id'] };
    const hidden: any = await getProjectTaskData('project1');
    expect(hidden.tasks).toEqual([]);
    expect(hidden.taskDependencies).toEqual({});
    expect(await getTaskById('task1')).toBeNull();
    expect(await getTaskWithDetails('task1')).toHaveProperty('actionError');
    const [phaseHidden, listHidden]: any[] = await Promise.all([
      getTasksForPhase('ph1'), getAllProjectTasksForListView('project1'),
    ]);
    expect(phaseHidden.tasks).toEqual([]);
    expect(listHidden.tasks).toEqual([]);
  });

  it('uses shared projections for phase, list, and detail reads', async () => {
    state.decision = { allowed: true, redactedFields: ['description'] };
    const [phaseResult, listResult, detailResult]: any[] = await Promise.all([
      getTasksForPhase('ph1'), getAllProjectTasksForListView('project1'), getTaskWithDetails('task1'),
    ]);
    expect(phaseResult.tasks[0].description).toBeNull();
    expect(listResult.tasks[0].description).toBeNull();
    expect(detailResult.description).toBeNull();
    expect(detailResult.description_rich_text).toBeNull();
  });
});
