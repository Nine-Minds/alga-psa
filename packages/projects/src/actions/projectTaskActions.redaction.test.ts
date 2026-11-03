import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  decision: { allowed: true, redactedFields: [] as string[] },
  decisionsByProject: {} as Record<string, { allowed: boolean; redactedFields: string[] }>,
  taskName: 'Map New Areas',
}));

vi.mock('@alga-psa/auth', () => ({ withAuth: (fn: any) => (...args: any[]) => fn({ user_id: 'u1', user_type: 'internal' }, { tenant: 't1' }, ...args) }));
vi.mock('@alga-psa/auth/rbac', () => ({ hasPermission: async () => true }));
vi.mock('@alga-psa/db', () => {
  const raw = (sql: string, args?: any[]) => ({ sql, args });
  const query = (table: string) => {
    let selection: any[] = [];
    let ordering: string | undefined;
    const filters: Array<{ kind: string; field: any; value: any }> = [];
    const q: any = new Proxy({}, { get(_target, prop) {
      if (prop === 'then') return (resolve: any) => {
        const result = rows(table, selection, filters);
        const orderColumn = ordering;
        if (table === 'project_phases' && orderColumn) result.sort((a: any, b: any) => String(a[orderColumn]).localeCompare(String(b[orderColumn])));
        return Promise.resolve(result).then(resolve);
      };
      if (prop === 'select') return (...columns: any[]) => { selection = columns; return q; };
      if (prop === 'first') return async () => table === 'project_tasks'
        ? { phase_name: 'Phase', project_id: 'project1', status_id: 'status1', assigned_to_first_name: null, assigned_to_last_name: null }
        : rows(table, selection, filters)[0];
      if (prop === 'where') return (field: any, value?: any) => { filters.push({ kind: 'where', field, value }); return q; };
      if (prop === 'whereIn') return (field: any, value: any) => { filters.push({ kind: 'whereIn', field, value }); return q; };
      if (prop === 'orderBy') return (field: string) => { ordering = field; return q; };
      return () => q;
    }});
    return q;
  };
  const rows = (table: string, selection: any[], filters: Array<{ kind: string; field: any; value: any }>) => {
    if (table === 'project_tasks as pt') {
      const taskId = filters.find((filter) => filter.kind === 'where' && typeof filter.field === 'object')?.field?.['pt.task_id'];
      return [{ project_id: ({ task1: 'project1', pred: 'project2', succ: 'project3' } as any)[taskId] ?? 'project1' }];
    }
    if (table === 'project_phases') {
      const nameMask = selection.flat().find((column) => column?.sql?.includes('as phase_name') || column?.args?.includes('phase_name'));
      const descriptionMask = selection.flat().some((column) => column?.sql?.includes('as description') || column?.args?.includes('description'));
      const wbsMask = selection.flat().some((column) => column?.sql?.includes('as wbs_code') || column?.args?.includes('wbs_code'));
      return [
        { phase_id: 'ph1', project_id: 'project1', phase_name: nameMask?.args?.[0] ?? 'Phase One', description: descriptionMask ? null : 'Phase one description', wbs_code: wbsMask ? null : '1', order_key: 'b' },
        { phase_id: 'ph2', project_id: 'project1', phase_name: nameMask?.args?.[0] ?? 'Phase Two', description: descriptionMask ? null : 'Phase two description', wbs_code: wbsMask ? null : '2', order_key: 'a' },
      ];
    }
    if (table === 'project_tasks') {
      const nameMask = selection.flat().find((column) => column?.sql?.includes('as task_name'));
      const title = nameMask?.args?.[0] ?? state.taskName;
      const descriptionMask = selection.flat().find((column) => column?.args?.includes('description') || column?.sql?.includes('as description'));
      const wbsMask = selection.flat().some((column) => column?.sql?.includes('NULL::') && column?.args?.includes('wbs_code'));
      const all = [
        { tenant: 't1', project_id: 'project1', task_id: 'task1', phase_id: 'ph1', task_name: title, description: descriptionMask ? null : 'Visible body', description_rich_text: descriptionMask ? null : 'Visible rich body', order_key: 'a', wbs_code: wbsMask ? null : '1' },
        { tenant: 't1', project_id: 'project2', task_id: 'pred', phase_id: 'ph2', task_name: title, description: descriptionMask ? null : 'Visible body', description_rich_text: descriptionMask ? null : 'Visible rich body', order_key: 'b', wbs_code: wbsMask ? null : '2' },
        { tenant: 't1', project_id: 'project3', task_id: 'succ', phase_id: 'ph3', task_name: title, description: descriptionMask ? null : 'Visible body', description_rich_text: descriptionMask ? null : 'Visible rich body', order_key: 'c', wbs_code: wbsMask ? null : '3' },
      ];
      let filtered = all;
      for (const filter of filters) {
        if (filter.kind === 'whereIn' && String(filter.field).includes('task_id')) filtered = filtered.filter((row) => filter.value.includes(row.task_id));
        if (filter.kind === 'where' && typeof filter.field === 'string' && filter.field.includes('project_id')) filtered = filtered.filter((row) => row.project_id === filter.value);
        if (filter.kind === 'where' && typeof filter.field === 'object' && filter.field['project_tasks.task_id']) filtered = filtered.filter((row) => row.task_id === filter.field['project_tasks.task_id']);
      }
      return filtered;
    }
    if (table === 'project_task_dependencies as ptd') {
      const maskedPred = selection.flat().find((column) => column?.sql?.includes('as predecessor_task_name'));
      const maskedSucc = selection.flat().find((column) => column?.sql?.includes('as successor_task_name'));
      const all = [
       { dependency_id: 'dep1', predecessor_task_id: 'pred', successor_task_id: 'task1',
        predecessor_task_name: maskedPred?.args?.[0] ?? 'Hidden Dependency', successor_task_name: maskedSucc?.args?.[0] ?? 'Hidden Successor',
        predecessor_task_wbs_code: '1', successor_task_wbs_code: '2', predecessor_task_type_key: 'type', successor_task_type_key: 'type', predecessor_wbs_code: 'RAW-PRED-WBS', successor_wbs_code: 'RAW-SUCC-WBS' },
       { dependency_id: 'dep2', predecessor_task_id: 'task1', successor_task_id: 'succ',
        predecessor_task_name: maskedPred?.args?.[0] ?? 'Hidden Dependency', successor_task_name: maskedSucc?.args?.[0] ?? 'Hidden Successor',
        predecessor_task_wbs_code: '1', successor_task_wbs_code: '3', predecessor_task_type_key: 'type', successor_task_type_key: 'type', predecessor_wbs_code: 'RAW-PRED-WBS-2', successor_wbs_code: 'RAW-SUCC-WBS-2' },
      ];
      const endpointFilter = filters.find((filter) => filter.kind === 'whereIn' && String(filter.field).includes('task_id'));
      return endpointFilter ? all.filter((edge) => endpointFilter.value.some((id: string) => edge.predecessor_task_id === id || edge.successor_task_id === id)) : all;
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
vi.mock('../lib/projectReadAuthorization', () => ({ createProjectReadDecider: async () => async (project: any) => state.decisionsByProject[project.project_id] ?? state.decision }));
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
  state.decisionsByProject = {};
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

  it('removes raw WBS aliases from both dependency directions in board, phase, and list responses', async () => {
    state.decisionsByProject = {
      project1: { allowed: true, redactedFields: ['wbs_code'] },
      project2: { allowed: true, redactedFields: ['wbs_code'] },
      project3: { allowed: true, redactedFields: ['wbs_code'] },
    };
    const results: any[] = await Promise.all([
      getProjectTaskData('project1'), getTasksForPhase('ph1'), getAllProjectTasksForListView('project1'),
    ]);
    for (const result of results) {
      expect(result.tasks[0]).toMatchObject({ task_id: 'task1', phase_id: 'ph1', wbs_code: null });
    }
    for (const result of results) {
      const serialized = JSON.stringify(result);
      expect(serialized).not.toContain('RAW-PRED-WBS');
      expect(serialized).not.toContain('RAW-SUCC-WBS');
      expect(serialized).not.toContain('"predecessor_wbs_code":"2"');
      expect(serialized).not.toContain('"successor_wbs_code":"3"');
    }

    state.decisionsByProject = {};
    const unrestrictedReaders: any[] = await Promise.all([
      getProjectTaskData('project1'), getTasksForPhase('ph1'), getAllProjectTasksForListView('project1'),
    ]);
    for (const unrestricted of unrestrictedReaders) {
      const predecessor = unrestricted.taskDependencies.task1.predecessors[0];
      const successor = unrestricted.taskDependencies.task1.successors[0];
      expect(predecessor.predecessor_wbs_code).toBe('2');
      expect(successor.successor_wbs_code).toBe('3');
    }
  });

  it('applies distinct endpoint redactions across projects', async () => {
    state.decisionsByProject = {
      project1: { allowed: true, redactedFields: [] },
      project2: { allowed: true, redactedFields: ['wbs_code'] },
      project3: { allowed: true, redactedFields: ['task_name'] },
    };
    const result: any = await getProjectTaskData('project1');
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('RAW-PRED-WBS');
    expect(serialized).not.toContain('RAW-SUCC-WBS');
    expect(result.taskDependencies.task1.predecessors[0].predecessor_wbs_code).toBeNull();
    expect(result.taskDependencies.task1.successors[0].successor_task_name).not.toBe('Map New Areas');
  });

  it('denies a dependency whose endpoint project is inaccessible', async () => {
    state.decisionsByProject = {
      project1: { allowed: true, redactedFields: [] },
      project2: { allowed: true, redactedFields: ['wbs_code'] },
      project3: { allowed: false, redactedFields: [] },
    };
    const denied: any = await getProjectTaskData('project1');
    expect(denied).toHaveProperty('permissionError');
    expect(JSON.stringify(denied)).not.toContain('RAW-PRED-WBS');
    expect(JSON.stringify(denied)).not.toContain('RAW-SUCC-WBS');
  });

  it('keeps the drawer task reader masked when ProjectDetail reopens a task by id', async () => {
    state.decision = { allowed: true, redactedFields: ['task_name', 'wbs_code'] };
    const result: any = await getTaskById('task1');
    expect(result.task_name).not.toBe('Map New Areas');
    expect(result.phase_id).toBe('ph1');
    expect(result.wbs_code).toBeNull();
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

  it('masks phase display fields in the task list using the effective project redactions', async () => {
    state.decision = { allowed: true, redactedFields: ['phase_name', 'description', 'wbs_code'] };
    const result: any = await getAllProjectTasksForListView('project1');
    expect(result.phases[0]).toMatchObject({ phase_name: 'Project phase', description: null, wbs_code: null });
    expect(JSON.stringify(result.phases)).not.toContain('Phase one description');
    expect(JSON.stringify(result.phases)).not.toContain('Phase two description');
  });

  it('preserves populated phase fields and task phase membership for unrestricted list reads', async () => {
    const result: any = await getAllProjectTasksForListView('project1');
    expect(result.phases.map((phase: any) => phase.phase_id)).toEqual(['ph2', 'ph1']);
    expect(result.phases.find((phase: any) => phase.phase_id === 'ph1')).toMatchObject({
      phase_name: 'Phase One', description: 'Phase one description', wbs_code: '1',
    });
    expect(result.tasks[0].phase_id).toBe('ph1');
  });
});
