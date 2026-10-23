import { readFileSync } from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

/**
 * ProjectDetail is too large to mount in a unit test, so the logic it owns for
 * the timeline lives in tested units (dependencyGuards, useDependencyGuard,
 * taskDependencyMap, useUrlTaskOpenGuard). These contracts pin the wiring:
 * every save path asks the dependency guard first, and the page uses those units.
 */
const source = readFileSync(path.resolve(__dirname, 'ProjectDetail.tsx'), 'utf8');

/** Source of one handler, from its declaration to the next top-level `const` in the component. */
function handlerBody(declaration: string): string {
  const start = source.indexOf(declaration);
  expect(start, `handler not found: ${declaration}`).toBeGreaterThan(-1);
  const next = source.indexOf('\n  const ', start + declaration.length);
  return source.slice(start, next === -1 ? undefined : next);
}

function expectGuardBeforeSave(body: string, saves: string[]) {
  const guard = body.indexOf('confirmTaskChanges(');
  expect(guard, 'handler never asks the dependency guard').toBeGreaterThan(-1);
  const firstSave = Math.min(...saves.map((save) => body.indexOf(save)).filter((index) => index > -1));
  expect(Number.isFinite(firstSave), 'handler has no save call to guard').toBe(true);
  expect(guard, 'dependency guard must run before the first save').toBeLessThan(firstSave);
}

describe('ProjectDetail dependency guard wiring', () => {
  it('builds the guard from the project-wide tasks, phases, dependencies and statuses', () => {
    expect(source).toContain('const { confirmTaskChanges, dependencyGuardDialog } = useDependencyGuard({');
    expect(source).toMatch(/useDependencyGuard\(\{\s*tasks: allProjectTasks,\s*phases: projectPhases,\s*taskDependencies: allTaskDependencies,\s*statuses: projectStatuses,\s*statusesByPhase,\s*\}\)/);
    expect(source).toContain('{dependencyGuardDialog}');
  });

  it('asks before a kanban drop changes a task status', () => {
    const body = handlerBody('const handleDrop = async (');
    expectGuardBeforeSave(body, ['updateTaskStatus(', 'moveTaskToPhase(']);
    // Reordering inside the same column is not a status change and must not ask.
    expect(body).toMatch(/task\.project_status_mapping_id !== targetStatusId &&\s*!\(await confirmTaskChanges\(/);
  });

  it('asks before a bulk kanban drop', () => {
    expectGuardBeforeSave(handlerBody('const handleBulkKanbanDrop = async ('), ['updateTaskStatus(', 'moveTaskToPhase(']);
  });

  it('asks before a list-view drag moves tasks to another status, for one task or a selection', () => {
    const body = handlerBody('const handleListViewTaskMove = useCallback(async (');
    expectGuardBeforeSave(body, ['updateTaskStatus(', 'moveTaskToPhase(']);
    expect(body).toContain('selectedTaskIds.has(taskId) && selectedTaskIds.size > 1 ? [...selectedTaskIds] : [taskId]');
  });

  it('asks before an inline list edit or a timeline drag changes status or dates, and only then', () => {
    const body = handlerBody('const handleListTaskUpdate = async (');
    expectGuardBeforeSave(body, ['updateTaskWithChecklist(']);
    expect(body).toContain("if ('project_status_mapping_id' in updates || 'start_date' in updates || 'due_date' in updates) {");
    expect(body).toContain('if (!(await confirmTaskChanges([{ taskId, change }]))) return;');
  });

  it('hands the guard to the task form', () => {
    expect(source).toContain('confirmBeforeSave={(taskId, change) => confirmTaskChanges([{ taskId, change }])}');
    const taskForm = readFileSync(path.resolve(__dirname, 'TaskForm.tsx'), 'utf8');
    const guard = taskForm.indexOf('await confirmBeforeSave(task.task_id, {');
    expect(guard).toBeGreaterThan(-1);
    // The form asks before any of its edit-mode saves.
    expect(guard).toBeLessThan(taskForm.indexOf('// Only call moveTaskToPhase if phase or status actually changed'));
    expect(taskForm.slice(guard, guard + 400)).toContain('if (!proceed) return;');
  });
});

describe('ProjectDetail timeline wiring', () => {
  it('routes timeline saves through the guarded list update handler', () => {
    expect(source).toContain('onTaskDatesChange={handleListTaskUpdate}');
  });

  it('adds and removes dependencies on the server, then mirrors them locally', () => {
    const add = handlerBody('const handleGanttAddDependency = async (');
    expect(add).toContain("await addTaskDependency(predecessorTaskId, successorTaskId, 'blocks')");
    expect(add).toContain('setAllTaskDependencies(prev => addDependencyToMap(prev, dependency))');
    // A rejected add must not be mirrored.
    expect(add.indexOf('isReturnedActionError(dependency)')).toBeLessThan(add.indexOf('addDependencyToMap('));

    const remove = handlerBody('const handleGanttRemoveDependency = async (');
    expect(remove).toContain('await removeTaskDependency(dependencyId)');
    expect(remove).toContain('setAllTaskDependencies(prev => removeDependencyFromMap(prev, dependencyId))');
    expect(remove.indexOf('isReturnedActionError(result)')).toBeLessThan(remove.indexOf('removeDependencyFromMap('));
  });

  it('gates editing on project update permission and passes the shared filters', () => {
    expect(source).toContain("setCanCompletePhase(granted('project', 'update'));");
    expect(source).toContain('canEdit={canCompletePhase}');
    expect(source).toContain('visibleTaskIds={hasActiveTaskFilters ? ganttVisibleTaskIds : undefined}');
    expect(source).toContain('onRemoveDependency={handleGanttRemoveDependency}');
  });

  it('persists timeline display settings with the other project view preferences', () => {
    expect(source).toContain("const PROJECT_GANTT_SETTINGS_SETTING = 'project_gantt_settings';");
    expect(source).toContain('settings={ganttSettings}');
    expect(source).toContain('onSettingsChange={setGanttSettings}');
  });

  it('accepts ?view=gantt as a deep link', () => {
    const page = readFileSync(path.resolve(__dirname, 'ProjectPage.tsx'), 'utf8');
    expect(page).toContain("viewFromUrlRaw === 'gantt'");
  });
});

describe('ProjectDetail timeline release flag', () => {
  it('offers the Timeline view only when release-v2-0-feature is on', () => {
    expect(source).toContain("useFeatureFlag('release-v2-0-feature', { defaultValue: false })");
    const options = handlerBody('const viewSwitcherOptions = useMemo(() => {');
    expect(options).toMatch(/if \(timelineEnabled\) \{\s*options\.push\(\{ value: 'gantt'/);
    expect(options).toContain('[t, timelineEnabled, canViewBilling, billingIntegration]');
  });

  it('falls back to kanban when the saved view or a deep link names the gated timeline', () => {
    expect(source).toContain("const viewMode: ProjectViewMode = storedViewMode === 'gantt' && !timelineEnabled ? 'kanban' : storedViewMode;");
    // The fallback is derived, not written back, so the preference returns once the flag is on.
    expect(source).not.toMatch(/timelineEnabled[^\n]*setViewMode|setViewMode\([^)]*timelineEnabled/);
  });
});

describe('ProjectDetail opening a task from the URL', () => {
  it('uses the open-once guard in both effects and when a task is clicked', () => {
    expect(source).toContain('const urlTaskOpenGuard = useUrlTaskOpenGuard();');
    expect(source).toContain('if (!urlTaskOpenGuard.arm(initialTaskId) || !initialTaskId) return;');
    expect(source).toContain('!urlTaskOpenGuard.canOpen()) return;');
    expect(source).toContain('urlTaskOpenGuard.markOpened(initialTaskId);');
    // A click marks the task handled before its id reaches the URL.
    const select = handlerBody('const handleTaskSelected = useCallback((task: IProjectTask) => {');
    expect(select.indexOf('urlTaskOpenGuard.markOpened(task.task_id);')).toBeGreaterThan(-1);
    expect(select.indexOf('urlTaskOpenGuard.markOpened(task.task_id);')).toBeLessThan(select.indexOf('onUrlUpdate(taskPhase.phase_id, task.task_id)'));
  });
});
