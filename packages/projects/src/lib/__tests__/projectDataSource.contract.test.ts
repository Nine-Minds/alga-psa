import { describe, expect, it, vi } from 'vitest';

const fns = vi.hoisted(() => {
  const mk = () => vi.fn().mockResolvedValue({ sentinel: true });
  return {
    projectActions: { getProjectMetadata: mk(), updateProject: mk(), getProjectTaskStatuses: mk(), getProjectStatusesByPhase: mk(), getProjectTreeData: mk(), reorderPhase: mk(), updatePhase: mk() },
    taskActions: { getProjectTaskData: mk(), getTasksForPhase: mk(), getTaskById: mk(), updateTaskStatus: mk(), reorderTask: mk(), reorderTasksInStatus: mk(), moveTaskToPhase: mk(), updateTaskWithChecklist: mk(), getTaskTypes: mk() },
    statusActions: { getPhaseCustomStatusCounts: mk() },
    commentActions: { getTaskCommentCountsBatch: mk() },
  };
});
vi.mock('../../actions/projectActions', () => fns.projectActions);
vi.mock('../../actions/projectTaskActions', () => fns.taskActions);
vi.mock('../../actions/projectTaskStatusActions', () => fns.statusActions);
vi.mock('../../actions/projectTaskCommentActions', () => fns.commentActions);

import { nativeProjectDataSource } from '../nativeProjectDataSource';
import { NATIVE_PROJECT_SCREEN, PROJECT_DATA_SOURCE_METHODS, projectDataSourceMethod, composeProjectDataSource } from '../projectDataSource';

const TARGET: Record<string, [Record<string, any>, string]> = {
  'project.metadata': [fns.projectActions, 'getProjectMetadata'], 'project.update': [fns.projectActions, 'updateProject'],
  'tasks.data': [fns.taskActions, 'getProjectTaskData'], 'tasks.forPhase': [fns.taskActions, 'getTasksForPhase'], 'tasks.get': [fns.taskActions, 'getTaskById'],
  'tasks.commentCounts': [fns.commentActions, 'getTaskCommentCountsBatch'], 'tasks.updateStatus': [fns.taskActions, 'updateTaskStatus'],
  'tasks.reorder': [fns.taskActions, 'reorderTask'], 'tasks.reorderInStatus': [fns.taskActions, 'reorderTasksInStatus'],
  'tasks.moveToPhase': [fns.taskActions, 'moveTaskToPhase'], 'tasks.update': [fns.taskActions, 'updateTaskWithChecklist'],
  'options.taskStatuses': [fns.projectActions, 'getProjectTaskStatuses'], 'options.statusesByPhase': [fns.projectActions, 'getProjectStatusesByPhase'],
  'options.types': [fns.taskActions, 'getTaskTypes'], 'options.tree': [fns.projectActions, 'getProjectTreeData'],
  'phases.customStatusCounts': [fns.statusActions, 'getPhaseCustomStatusCounts'], 'phases.reorder': [fns.projectActions, 'reorderPhase'], 'phases.update': [fns.projectActions, 'updatePhase'],
};

describe('native project data source contract', () => {
  it('is a frozen native singleton with a neutral screen', () => {
    expect(Object.isFrozen(nativeProjectDataSource)).toBe(true);
    expect(nativeProjectDataSource.kind).toBe('native');
    expect(nativeProjectDataSource.screen).toBe(NATIVE_PROJECT_SCREEN);
    expect(nativeProjectDataSource.screen).toMatchObject({ readOnly: false, hideCreate: false, hidePhaseMoves: false, hideKanbanDrag: false, freezeProjectEdit: false, admittedTaskEdit: false, backHref: null });
    expect(nativeProjectDataSource.screen.slots).toEqual({ conversations: null, timeSummary: null, taskAside: null });
  });

  it('exposes every path in PROJECT_DATA_SOURCE_METHODS as a function', () => {
    for (const path of PROJECT_DATA_SOURCE_METHODS) expect(typeof projectDataSourceMethod(nativeProjectDataSource, path), path).toBe('function');
  });

  it('forwards each method to its action with the arguments and result unchanged', async () => {
    for (const path of PROJECT_DATA_SOURCE_METHODS.filter(p => p !== 'editTask')) {
      const [mod, key] = TARGET[path];
      const args = [`${path}-a`, { b: 1 }, null];
      const result = await (projectDataSourceMethod(nativeProjectDataSource, path) as (...a: unknown[]) => Promise<unknown>)(...args);
      expect(mod[key], path).toHaveBeenCalledWith(...args);
      expect(result, path).toEqual({ sentinel: true });
    }
  });

  it('editTask forwards to updateTaskWithChecklist and maps returned action errors, not throwing them away', async () => {
    fns.taskActions.updateTaskWithChecklist.mockResolvedValueOnce({ task_id: 't' });
    await expect(nativeProjectDataSource.editTask({ taskId: 't', changes: { task_name: 'x' } })).resolves.toEqual({ ok: true, task: { task_id: 't' } });
    expect(fns.taskActions.updateTaskWithChecklist).toHaveBeenLastCalledWith('t', { task_name: 'x' });
    fns.taskActions.updateTaskWithChecklist.mockResolvedValueOnce({ actionError: 'nope' });
    await expect(nativeProjectDataSource.editTask({ taskId: 't', changes: {} })).resolves.toMatchObject({ ok: false, code: 'failed', message: 'nope' });
  });

  it('composes one level deep without mutating the base', () => {
    const composed = composeProjectDataSource(nativeProjectDataSource, { kind: 'co-managed-shared', tasks: { get: async () => null } as never });
    expect(composed.kind).toBe('co-managed-shared');
    expect(composed.tasks.data).toBe(nativeProjectDataSource.tasks.data);
    expect(nativeProjectDataSource.kind).toBe('native');
  });
});
