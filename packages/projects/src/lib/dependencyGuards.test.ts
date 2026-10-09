import { describe, expect, it } from 'vitest';

import type { IProjectPhase, IProjectTask, ProjectStatus } from '@alga-psa/types';
import { dependencyWarnings } from './dependencyGuards';
import type { GanttEdge } from './ganttSchedule';

const day = (iso: string) => new Date(`${iso}T00:00:00`);
const TODAY = day('2026-10-05');

const status = (id: string, order: number, closed = false) =>
  ({ project_status_mapping_id: id, name: id, custom_name: null, display_order: order, is_closed: closed }) as ProjectStatus;
const statuses = [status('todo', 1), status('doing', 2), status('done', 3, true)];

const task = (id: string, overrides: Partial<IProjectTask> = {}) =>
  ({
    tenant: 't',
    task_id: id,
    phase_id: 'p',
    task_name: `Task ${id}`,
    estimated_hours: 0,
    actual_hours: 0,
    project_status_mapping_id: 'todo',
    wbs_code: `1.${id}`,
    start_date: null,
    due_date: null,
    task_type_key: 'task',
    ...overrides,
  }) as IProjectTask;

const phases = [{ tenant: 't', phase_id: 'p', project_id: 'x', phase_name: 'P', start_date: null, end_date: null }] as unknown as IProjectPhase[];
const blocks = (from: string, to: string): GanttEdge => ({
  dependencyId: `${from}->${to}`,
  predecessorTaskId: from,
  successorTaskId: to,
  leadLagDays: 0,
  kind: 'blocks',
});

const tasks = [
  task('a', { start_date: day('2026-10-05'), due_date: day('2026-10-09') }),
  task('b', { start_date: day('2026-10-12'), due_date: day('2026-10-14') }),
  task('c'),
];
const context = { tasks, phases, edges: [blocks('a', 'b')], statuses, today: TODAY };

describe('dependencyWarnings: status', () => {
  it('warns when a blocked task is moved forward', () => {
    expect(dependencyWarnings(context, [{ taskId: 'b', change: { project_status_mapping_id: 'doing' } }])).toEqual([
      { kind: 'blocked-status', taskName: 'Task b', statusName: 'doing', blockerNames: ['Task a'] },
    ]);
    expect(dependencyWarnings(context, [{ taskId: 'b', change: { project_status_mapping_id: 'done' } }])).toHaveLength(1);
  });

  it('stays quiet once the blocker is closed, for backward moves, and for unblocked tasks', () => {
    const closedBlocker = { ...context, tasks: tasks.map((t) => (t.task_id === 'a' ? { ...t, project_status_mapping_id: 'done' } : t)) };
    expect(dependencyWarnings(closedBlocker, [{ taskId: 'b', change: { project_status_mapping_id: 'doing' } }])).toEqual([]);

    const started = { ...context, tasks: tasks.map((t) => (t.task_id === 'b' ? { ...t, project_status_mapping_id: 'doing' } : t)) };
    expect(dependencyWarnings(started, [{ taskId: 'b', change: { project_status_mapping_id: 'todo' } }])).toEqual([]);

    expect(dependencyWarnings(context, [{ taskId: 'c', change: { project_status_mapping_id: 'doing' } }])).toEqual([]);
    expect(dependencyWarnings(context, [{ taskId: 'b', change: { project_status_mapping_id: 'todo' } }])).toEqual([]);
  });
});

describe('dependencyWarnings: dates', () => {
  it('warns when a task is dated before its blocker finishes', () => {
    expect(
      dependencyWarnings(context, [{ taskId: 'b', change: { start_date: day('2026-10-07'), due_date: day('2026-10-08') } }]),
    ).toEqual([{ kind: 'starts-before-blocker', taskName: 'Task b', otherTaskName: 'Task a' }]);
  });

  it('warns when a blocker is pushed past the task waiting on it', () => {
    expect(dependencyWarnings(context, [{ taskId: 'a', change: { due_date: day('2026-10-13') } }])).toEqual([
      { kind: 'ends-after-dependent', taskName: 'Task a', otherTaskName: 'Task b' },
    ]);
  });

  it('accepts dates that respect the dependency and unchanged dates', () => {
    expect(dependencyWarnings(context, [{ taskId: 'b', change: { start_date: day('2026-10-13') } }])).toEqual([]);
    expect(
      dependencyWarnings(context, [{ taskId: 'b', change: { start_date: day('2026-10-12'), due_date: day('2026-10-14') } }]),
    ).toEqual([]);
  });

  it('does not repeat a conflict that already existed', () => {
    const conflicted = { ...context, tasks: tasks.map((t) => (t.task_id === 'b' ? { ...t, start_date: day('2026-10-07') } : t)) };
    expect(dependencyWarnings(conflicted, [{ taskId: 'b', change: { start_date: day('2026-10-06') } }])).toEqual([]);
  });

  it('reports status and date problems together', () => {
    const warnings = dependencyWarnings(context, [
      { taskId: 'b', change: { project_status_mapping_id: 'doing', start_date: day('2026-10-07') } },
    ]);
    expect(warnings.map((warning) => warning.kind)).toEqual(['blocked-status', 'starts-before-blocker']);
  });
});
