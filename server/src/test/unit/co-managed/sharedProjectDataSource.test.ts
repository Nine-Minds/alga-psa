import { beforeEach, describe, expect, it, vi } from 'vitest';

// No native project action may run from a shared source: mock every module nativeProjectDataSource forwards to.
const { nativeCalls, trap } = vi.hoisted(() => {
  const nativeCalls = { n: 0 };
  const trap = () => new Proxy({}, { get: (_t, key) => (key === 'then' || key === '__esModule' ? undefined : () => { nativeCalls.n += 1; return undefined; }) });
  return { nativeCalls, trap };
});
vi.mock('@alga-psa/projects/actions/projectActions', trap);
vi.mock('@alga-psa/projects/actions/projectTaskActions', trap);
vi.mock('@alga-psa/projects/actions/projectTaskStatusActions', trap);
vi.mock('@alga-psa/projects/actions/projectTaskCommentActions', trap);
vi.mock('../../../../../packages/projects/src/actions/projectActions', trap);
vi.mock('../../../../../packages/projects/src/actions/projectTaskActions', trap);
vi.mock('../../../../../packages/projects/src/actions/projectTaskStatusActions', trap);
vi.mock('../../../../../packages/projects/src/actions/projectTaskCommentActions', trap);

import {
  CoManagedReadOnlyProjectError, createCoManagedSharedProjectDataSource, loadCoManagedSharedProjectDataSource,
  type CoManagedSharedProjectDataSourceDeps, type CoManagedSharedProjectRead,
} from '@/lib/co-managed/sharedProjectDataSource';
import { nativeProjectDataSource } from '@alga-psa/projects/lib/nativeProjectDataSource';
import { PROJECT_DATA_SOURCE_METHODS, projectDataSourceMethod, PROJECT_TASK_SCREEN_FIELDS } from '@alga-psa/projects/lib/projectDataSource';

const P = 'p1', PH = 'ph1';
const read = (over: Partial<CoManagedSharedProjectRead> = {}): CoManagedSharedProjectRead => ({
  project: { projectId: P, projectName: 'Rollout', statusName: 'Active', isClosed: false, startDate: null, endDate: null, organizationName: 'Acme' },
  canCollaborate: true,
  phases: [{ phaseId: PH, projectId: P, phaseName: 'Phase 1', wbsCode: '1', orderKey: 'a' }],
  statuses: [{ statusMappingId: 'm1', phaseId: null, name: 'To Do', customName: null, displayOrder: 1, isVisible: true, isClosed: false, color: null, icon: null },
    { statusMappingId: 'm2', phaseId: null, name: 'Done', customName: null, displayOrder: 2, isVisible: true, isClosed: true, color: null, icon: null }],
  statusesByPhase: {},
  tasks: [
    { taskId: 't1', taskName: 'Patch', phaseId: PH, statusMappingId: 'm1', dueDate: '2026-10-20T00:00:00.000Z', wbsCode: '1.1', orderKey: 'a', taskUpdatedAt: '2026-10-01T10:00:00.000Z',
      reference: { revision: 3, assigneeName: 'Quinn', assignedToMe: true } },
    { taskId: 't2', taskName: 'Unassigned', phaseId: PH, statusMappingId: 'm1', dueDate: null, wbsCode: '1.2', orderKey: 'b', taskUpdatedAt: '2026-10-01T10:00:00.000Z', reference: null },
  ],
  redactedFields: [], hiddenTaskFields: [],
  ...over,
});

const build = (over: Partial<CoManagedSharedProjectRead> = {}, edit = vi.fn()) => {
  const deps: CoManagedSharedProjectDataSourceDeps = {
    customerTenant: 'c1', relationshipId: 'r1', projectId: P, backHref: '/msp/co-management/tasks',
    load: async () => read(over), edit: edit as never,
  };
  const handle = createCoManagedSharedProjectDataSource(deps, read(over));
  return { ...handle, edit, deps };
};

beforeEach(() => { nativeCalls.n = 0; });

describe('shared project data source contract', () => {
  it('exposes exactly the native surface', () => {
    const { source } = build();
    for (const path of PROJECT_DATA_SOURCE_METHODS) {
      expect(projectDataSourceMethod(nativeProjectDataSource, path), `native ${path}`).toBeTypeOf('function');
      expect(projectDataSourceMethod(source, path), `shared ${path}`).toBeTypeOf('function');
    }
    expect(source.kind).toBe('co-managed-shared');
    expect(source.boundProjectId).toBe(P);
  });

  it.each(['tasks.reorder', 'tasks.reorderInStatus', 'tasks.moveToPhase', 'tasks.update', 'project.update', 'phases.reorder', 'phases.update'] as const)('%s throws and reaches no native action', async path => {
    const { source, edit } = build();
    const fn = projectDataSourceMethod(source, path)!;
    expect(() => fn('x')).toThrow(CoManagedReadOnlyProjectError);
    expect(edit).not.toHaveBeenCalled();
    expect(nativeCalls.n).toBe(0);
  });

  it('serves reads without any native call', async () => {
    const { source } = build();
    expect(await source.project.metadata(P)).toMatchObject({ project: { project_name: 'Rollout', client_name: 'Acme' }, users: [], clients: [], assignedUser: null });
    expect(((await source.tasks.data(P)) as any).tasks.map((t: any) => t.task_id)).toEqual(['t1', 't2']);
    expect(((await source.tasks.forPhase(PH)) as any).tasks).toHaveLength(2);
    expect(await source.tasks.get('t1')).toMatchObject({ task_id: 't1', task_name: 'Patch' });
    expect(await source.tasks.commentCounts(['t1'])).toEqual({ t1: 0 });
    expect(await source.options.taskStatuses(P)).toHaveLength(2);
    expect(await source.options.types()).toEqual([]);
    expect(await source.tasks.checklist('t1')).toEqual([]);
    expect(await source.tasks.resources('t1')).toEqual([]);
    expect(await source.tasks.ticketLinks('t1')).toEqual([]);
    // A phase that never forked uses the project defaults, so its board is not empty.
    expect(await source.options.taskStatuses(P, PH)).toHaveLength(2);
    expect(Object.keys((await source.options.statusesByPhase(P)) as object)).toEqual([PH]);
    expect(await source.options.tree()).toEqual([]);
    expect(await source.phases.customStatusCounts(P)).toEqual({});
    expect(nativeCalls.n).toBe(0);
  });

  it('screen behaviour: status drag admitted, everything structural frozen', () => {
    const { source } = build();
    expect(source.screen).toMatchObject({ readOnly: false, admittedTaskEdit: true, hideCreate: true, hidePhaseMoves: true, hideKanbanDrag: false, freezeProjectEdit: true, backHref: '/msp/co-management/tasks' });
    expect(source.screen.slots).toEqual({ conversations: null, timeSummary: null, taskAside: null });
    expect(source.screen.frozenFields).toEqual(PROJECT_TASK_SCREEN_FIELDS.filter(f => !['task_name', 'project_status_mapping_id', 'due_date'].includes(f)));
  });

  it('hidden fields come from the read and are not also frozen', () => {
    const { source } = build({ hiddenTaskFields: ['due_date'] });
    expect(source.screen.hiddenFields).toEqual(['due_date']);
    expect(source.screen.frozenFields).not.toContain('due_date');
  });

  it('a project or task outside the bound project is unreachable', async () => {
    const { source, edit } = build();
    expect(await source.project.metadata('other')).toEqual({ actionError: 'Project not found' });
    expect(await source.tasks.data('other')).toEqual({ actionError: 'Project not found' });
    expect(await source.tasks.forPhase('other-phase')).toEqual({ actionError: 'Project not found' });
    expect(await source.tasks.get('other-task')).toBeNull();
    expect(await source.options.taskStatuses('other')).toEqual([]);
    expect(await source.editTask({ taskId: 'other-task', changes: { task_name: 'x' } })).toMatchObject({ ok: false, code: 'not_found' });
    expect(await source.tasks.updateStatus('other-task', 'm2')).toHaveProperty('actionError');
    expect(edit).not.toHaveBeenCalled();
  });

  it('load returns null for a not-served read or a different project', async () => {
    const deps = { customerTenant: 'c1', relationshipId: 'r1', projectId: P, backHref: '/b', edit: vi.fn() as never };
    expect(await loadCoManagedSharedProjectDataSource({ ...deps, load: async () => null })).toBeNull();
    expect(await loadCoManagedSharedProjectDataSource({ ...deps, load: async () => read({ project: { ...read().project, projectId: 'zzz' } }) })).toBeNull();
    expect(await loadCoManagedSharedProjectDataSource({ ...deps, load: async () => read() })).not.toBeNull();
  });
});

describe('shared project editTask', () => {
  it('refuses a non-admitted field and writes nothing', async () => {
    const { source, edit } = build();
    const result = await source.editTask({ taskId: 't1', changes: { description: 'x' } });
    expect(result).toEqual({ ok: false, code: 'refused', refusedFields: ['description'] });
    expect(edit).not.toHaveBeenCalled();
  });

  it('refuses mixed admitted and non-admitted changes without a partial save', async () => {
    const { source, edit } = build();
    const result = await source.editTask({ taskId: 't1', changes: { task_name: 'New', priority_id: 'p' } });
    expect(result).toEqual({ ok: false, code: 'refused', refusedFields: ['priority_id'] });
    expect(edit).not.toHaveBeenCalled();
  });

  it('refuses a hidden admitted field', async () => {
    const { source, edit } = build({ hiddenTaskFields: ['due_date'] });
    expect(await source.editTask({ taskId: 't1', changes: { due_date: null } })).toMatchObject({ code: 'refused', refusedFields: ['due_date'] });
    expect(edit).not.toHaveBeenCalled();
  });

  it('sends exactly the admitted patch with the loaded baselines, then advances them', async () => {
    const edit = vi.fn(async () => ({ success: true as const, receipt: { revision: 4, taskUpdatedAt: '2026-10-02T10:00:00.000Z' } }));
    const { source } = build({}, edit);
    const due = new Date('2026-11-01T00:00:00.000Z');
    const result = await source.editTask({ taskId: 't1', operationId: 'op-1', changes: { task_name: 'Patched', due_date: due, project_status_mapping_id: 'm2' } });
    expect(edit).toHaveBeenCalledWith('t1', { operationId: 'op-1', expectedRevision: 3, expectedTaskUpdatedAt: '2026-10-01T10:00:00.000Z',
      patch: { task_name: 'Patched', project_status_mapping_id: 'm2', due_date: due.toISOString() } });
    expect(result).toMatchObject({ ok: true, task: { task_name: 'Patched', project_status_mapping_id: 'm2' } });
    await source.editTask({ taskId: 't1', changes: { task_name: 'Again' } });
    expect(edit).toHaveBeenLastCalledWith('t1', expect.objectContaining({ expectedRevision: 4, expectedTaskUpdatedAt: '2026-10-02T10:00:00.000Z' }));
  });

  it('a task with no MSP reference is not editable', async () => {
    const { source, edit } = build();
    expect(await source.editTask({ taskId: 't2', changes: { task_name: 'x' } })).toEqual({ ok: false, code: 'not_found', message: 'Assign this task to edit it' });
    expect(edit).not.toHaveBeenCalled();
  });

  it.each(['revision', 'customer_drift'] as const)('maps a %s conflict to the fresh task and adopts the fresh baseline', async reason => {
    const edit = vi.fn()
      .mockResolvedValueOnce({ success: false, error: 'CONFLICT', reason, snapshot: { revision: 5, taskUpdatedAt: '2026-10-03T00:00:00.000Z', values: { task_name: 'Renamed' }, assignee: null } })
      .mockResolvedValueOnce({ success: true, receipt: { revision: 6, taskUpdatedAt: '2026-10-04T00:00:00.000Z' } });
    const { source } = build({}, edit);
    const result = await source.editTask({ taskId: 't1', changes: { task_name: 'Mine' } });
    expect(result).toMatchObject({ ok: false, code: 'conflict', task: { task_name: 'Renamed' } });
    await source.editTask({ taskId: 't1', changes: { task_name: 'Retry' } });
    expect(edit).toHaveBeenLastCalledWith('t1', expect.objectContaining({ expectedRevision: 5, expectedTaskUpdatedAt: '2026-10-03T00:00:00.000Z' }));
  });

  it('maps INVALID and NOT_FOUND', async () => {
    const edit = vi.fn().mockResolvedValueOnce({ success: false, error: 'INVALID' }).mockResolvedValueOnce({ success: false, error: 'NOT_FOUND' });
    const { source } = build({}, edit);
    expect(await source.editTask({ taskId: 't1', changes: { task_name: 'a' } })).toMatchObject({ ok: false, code: 'invalid' });
    expect(await source.editTask({ taskId: 't1', changes: { task_name: 'a' } })).toMatchObject({ ok: false, code: 'not_found' });
  });

  it('keeps the operation id stable for an identical retry after a thrown (ambiguous) call', async () => {
    let n = 0;
    const edit = vi.fn().mockRejectedValueOnce(new Error('network')).mockResolvedValueOnce({ success: true, receipt: { revision: 4, taskUpdatedAt: '2026-10-02T00:00:00.000Z' } });
    const deps: CoManagedSharedProjectDataSourceDeps = { customerTenant: 'c1', relationshipId: 'r1', projectId: P, backHref: '/b', load: async () => read(), edit: edit as never, newOperationId: () => `op-${++n}` };
    const { source } = createCoManagedSharedProjectDataSource(deps, read());
    expect(await source.editTask({ taskId: 't1', changes: { task_name: 'x' } })).toMatchObject({ ok: false, code: 'failed' });
    await source.editTask({ taskId: 't1', changes: { task_name: 'x' } });
    expect(edit.mock.calls[0][1].operationId).toBe('op-1');
    expect(edit.mock.calls[1][1].operationId).toBe('op-1');
  });

  it('updateStatus re-points at the admitted edit with only the status', async () => {
    const edit = vi.fn(async () => ({ success: true as const, receipt: { revision: 4, taskUpdatedAt: '2026-10-02T10:00:00.000Z' } }));
    const { source } = build({}, edit);
    const task = await source.tasks.updateStatus('t1', 'm2', null, null);
    expect(edit).toHaveBeenCalledWith('t1', expect.objectContaining({ expectedRevision: 3, patch: { project_status_mapping_id: 'm2' } }));
    expect(task).toMatchObject({ project_status_mapping_id: 'm2' });
    expect(nativeCalls.n).toBe(0);
  });

  it('updateStatus reports a conflict as an action error, not a lost write', async () => {
    const edit = vi.fn(async () => ({ success: false as const, error: 'CONFLICT' as const, reason: 'revision' as const, snapshot: undefined }));
    const { source } = build({}, edit);
    expect(await source.tasks.updateStatus('t1', 'm2', null, null)).toHaveProperty('actionError');
  });
});
