import { describe, expect, it } from 'vitest';

import type { IProjectPhase, IProjectTask } from '@alga-psa/types';
import {
  addWorkingDays,
  applyBarDrag,
  collectGanttEdges,
  findCriticalPath,
  findViolatedEdges,
  fitTimeline,
  ganttDomain,
  MIN_DOMAIN_DAYS,
  scheduleGanttBars,
  subtractWorkingDays,
  taskProgress,
  diffInDays,
  type GanttEdge,
} from './ganttSchedule';

// 2026-10-05 is a Monday.
const day = (iso: string) => new Date(`${iso}T00:00:00`);
const MONDAY = day('2026-10-05');

function task(id: string, overrides: Partial<IProjectTask> = {}): IProjectTask {
  return {
    tenant: 'tenant-1',
    task_id: id,
    phase_id: 'phase-1',
    task_name: id,
    description: null,
    assigned_to: null,
    estimated_hours: 0,
    actual_hours: 0,
    project_status_mapping_id: 'status-1',
    created_at: MONDAY,
    updated_at: MONDAY,
    wbs_code: `1.${id}`,
    start_date: null,
    due_date: null,
    task_type_key: 'task',
    ...overrides,
  } as IProjectTask;
}

function phase(overrides: Partial<IProjectPhase> = {}): IProjectPhase {
  return {
    tenant: 'tenant-1',
    phase_id: 'phase-1',
    project_id: 'project-1',
    phase_name: 'Phase',
    description: null,
    start_date: null,
    end_date: null,
    status: 'active',
    order_number: 1,
    created_at: MONDAY,
    updated_at: MONDAY,
    wbs_code: '1',
    ...overrides,
  } as IProjectPhase;
}

function blocks(from: string, to: string, leadLagDays = 0): GanttEdge {
  return { dependencyId: `${from}->${to}`, predecessorTaskId: from, successorTaskId: to, leadLagDays, kind: 'blocks' };
}

describe('working-day helpers', () => {
  it('spans weekends when counting working days', () => {
    // Thu + 3 working days = Thu, Fri, Mon.
    expect(addWorkingDays(day('2026-10-08'), 3)).toEqual(day('2026-10-12'));
    expect(subtractWorkingDays(day('2026-10-12'), 3)).toEqual(day('2026-10-08'));
  });

  it('starts a span on Monday when asked to start on a weekend', () => {
    expect(addWorkingDays(day('2026-10-10'), 1)).toEqual(day('2026-10-12'));
  });
});

describe('collectGanttEdges', () => {
  it('dedupes edges listed under both tasks and skips unknown types', () => {
    const dep = {
      dependency_id: 'd1',
      predecessor_task_id: 'a',
      successor_task_id: 'b',
      dependency_type: 'blocks',
      lead_lag_days: 2,
    } as any;
    const edges = collectGanttEdges({
      a: { predecessors: [], successors: [dep] },
      b: { predecessors: [dep, { ...dep, dependency_id: 'd2', dependency_type: 'duplicates' }], successors: [] },
    });
    expect(edges).toEqual([
      { dependencyId: 'd1', predecessorTaskId: 'a', successorTaskId: 'b', leadLagDays: 2, kind: 'blocks' },
    ]);
  });

  it('flips a stored blocked_by row so the blocker comes first', () => {
    const edges = collectGanttEdges({
      a: {
        predecessors: [],
        successors: [{
          dependency_id: 'd1',
          predecessor_task_id: 'a',
          successor_task_id: 'b',
          dependency_type: 'blocked_by',
          lead_lag_days: 0,
        } as any],
      },
    });
    // "a blocked_by b": b must finish before a.
    expect(edges[0]).toMatchObject({ predecessorTaskId: 'b', successorTaskId: 'a', kind: 'blocks' });
  });
});

describe('scheduleGanttBars', () => {
  it('keeps entered dates and marks them as not derived', () => {
    const bars = scheduleGanttBars({
      tasks: [task('a', { start_date: day('2026-10-06'), due_date: day('2026-10-09') })],
      phases: [phase()],
      edges: [],
      today: MONDAY,
    });
    expect(bars.get('a')).toMatchObject({
      start: day('2026-10-06'),
      end: day('2026-10-09'),
      derivedStart: false,
      derivedEnd: false,
    });
  });

  it('infers an undated task from today and its estimate, in working days', () => {
    // 16h = 2 working days, starting Friday -> ends Monday.
    const bars = scheduleGanttBars({
      tasks: [task('a', { estimated_hours: 16 * 60 })],
      phases: [phase()],
      edges: [],
      today: day('2026-10-09'),
    });
    expect(bars.get('a')).toMatchObject({
      start: day('2026-10-09'),
      end: day('2026-10-12'),
      derivedStart: true,
      derivedEnd: true,
    });
  });

  it('starts from the phase start when there is no chain', () => {
    const bars = scheduleGanttBars({
      tasks: [task('a')],
      phases: [phase({ start_date: day('2026-10-14') })],
      edges: [],
      today: MONDAY,
    });
    expect(bars.get('a')!.start).toEqual(day('2026-10-14'));
  });

  it('chains a successor after its predecessor, skipping the weekend', () => {
    const bars = scheduleGanttBars({
      tasks: [task('a', { start_date: day('2026-10-08'), due_date: day('2026-10-09') }), task('b')],
      phases: [phase()],
      edges: [blocks('a', 'b')],
      today: MONDAY,
    });
    // a ends Friday; b lands on Monday, not Saturday.
    expect(bars.get('b')!.start).toEqual(day('2026-10-12'));
  });

  it('applies lag and lead to the hand-off', () => {
    const tasks = [task('a', { start_date: MONDAY, due_date: MONDAY }), task('b')];
    const lagged = scheduleGanttBars({ tasks, phases: [phase()], edges: [blocks('a', 'b', 2)], today: MONDAY });
    expect(lagged.get('b')!.start).toEqual(day('2026-10-08'));
    const led = scheduleGanttBars({ tasks, phases: [phase()], edges: [blocks('a', 'b', -1)], today: MONDAY });
    expect(led.get('b')!.start).toEqual(MONDAY);
  });

  it('never lets a related edge move a bar', () => {
    const bars = scheduleGanttBars({
      tasks: [task('a', { start_date: day('2026-10-20'), due_date: day('2026-10-21') }), task('b')],
      phases: [phase()],
      edges: [{ ...blocks('a', 'b'), kind: 'related' }],
      today: MONDAY,
    });
    expect(bars.get('b')!.start).toEqual(MONDAY);
  });

  it('stretches a due-date-only task back to its earliest start', () => {
    const bars = scheduleGanttBars({
      tasks: [task('a', { due_date: day('2026-10-09') })],
      phases: [phase()],
      edges: [],
      today: MONDAY,
    });
    expect(bars.get('a')).toMatchObject({ start: MONDAY, end: day('2026-10-09'), derivedStart: true, derivedEnd: false });
  });

  it('backs a due-date-only task off its due date once the chain has overrun it', () => {
    const bars = scheduleGanttBars({
      tasks: [task('a', { due_date: day('2026-10-01'), estimated_hours: 16 * 60 })],
      phases: [phase()],
      edges: [],
      today: MONDAY,
    });
    expect(bars.get('a')).toMatchObject({ start: day('2026-09-30'), end: day('2026-10-01') });
  });

  it('still places every task when stale rows form a cycle', () => {
    const bars = scheduleGanttBars({
      tasks: [task('a'), task('b')],
      phases: [phase()],
      edges: [blocks('a', 'b'), blocks('b', 'a')],
      today: MONDAY,
    });
    expect(bars.size).toBe(2);
  });

  it('collapses a due date before the start to a single day', () => {
    const bars = scheduleGanttBars({
      tasks: [task('a', { start_date: day('2026-10-09'), due_date: day('2026-10-06') })],
      phases: [phase()],
      edges: [],
      today: MONDAY,
    });
    expect(bars.get('a')).toMatchObject({ start: day('2026-10-09'), end: day('2026-10-09') });
  });
});

describe('findViolatedEdges', () => {
  it('flags a successor dated before its predecessor finishes', () => {
    const edges = [blocks('a', 'b')];
    const bars = scheduleGanttBars({
      tasks: [
        task('a', { start_date: day('2026-10-06'), due_date: day('2026-10-09') }),
        task('b', { start_date: day('2026-10-07'), due_date: day('2026-10-08') }),
      ],
      phases: [phase()],
      edges,
      today: MONDAY,
    });
    expect([...findViolatedEdges(edges, bars)]).toEqual(['a->b']);
  });

  it('accepts a successor dated on the weekend right after its predecessor', () => {
    const edges = [blocks('a', 'b')];
    const bars = scheduleGanttBars({
      tasks: [
        task('a', { start_date: day('2026-10-08'), due_date: day('2026-10-09') }),
        task('b', { start_date: day('2026-10-10'), due_date: day('2026-10-12') }),
      ],
      phases: [phase()],
      edges,
      today: MONDAY,
    });
    expect(findViolatedEdges(edges, bars).size).toBe(0);
  });
});

describe('findCriticalPath', () => {
  it('follows the zero-slack chain back from the latest task and ignores slack branches', () => {
    const edges = [blocks('a', 'b'), blocks('b', 'c'), blocks('x', 'c')];
    const bars = scheduleGanttBars({
      tasks: [
        task('a', { estimated_hours: 16 * 60 }),
        task('b', { estimated_hours: 16 * 60 }),
        task('c'),
        // Finishes Monday, long before c can start: has slack.
        task('x', { start_date: MONDAY, due_date: MONDAY }),
      ],
      phases: [phase()],
      edges,
      today: MONDAY,
    });
    const critical = findCriticalPath(edges, bars);
    expect([...critical.taskIds].sort()).toEqual(['a', 'b', 'c']);
    expect([...critical.edgeIds].sort()).toEqual(['a->b', 'b->c']);
  });

  it('is empty for an empty chart', () => {
    expect(findCriticalPath([], new Map()).taskIds.size).toBe(0);
  });
});

describe('taskProgress', () => {
  it('prefers closed, then checklist, then logged time', () => {
    expect(taskProgress({ task: task('a'), closed: true })).toBe(1);
    expect(taskProgress({ task: task('a'), closed: false, checklist: { total: 4, completed: 1 } })).toBe(0.25);
    expect(taskProgress({ task: task('a', { estimated_hours: 120, actual_hours: 60 }), closed: false })).toBe(0.5);
    expect(taskProgress({ task: task('a', { estimated_hours: 60, actual_hours: 600 }), closed: false })).toBe(1);
    expect(taskProgress({ task: task('a'), closed: false })).toBe(0);
  });
});

describe('applyBarDrag', () => {
  const bar = { taskId: 'a', start: day('2026-10-06'), end: day('2026-10-08'), derivedStart: false, derivedEnd: false };

  it('moves both ends together', () => {
    expect(applyBarDrag(bar, 'move', 2)).toEqual({ start: day('2026-10-08'), end: day('2026-10-10') });
  });

  it('resizes one edge without crossing the other', () => {
    expect(applyBarDrag(bar, 'resize-end', -10)).toEqual({ start: bar.start, end: bar.start });
    expect(applyBarDrag(bar, 'resize-start', 10)).toEqual({ start: bar.end, end: bar.end });
    expect(applyBarDrag(bar, 'resize-end', 1)).toEqual({ start: bar.start, end: day('2026-10-09') });
  });
});

describe('ganttDomain', () => {
  it('pads the content and never shrinks below the minimum span', () => {
    const bars = scheduleGanttBars({ tasks: [task('a')], phases: [phase()], edges: [], today: MONDAY });
    const domain = ganttDomain(bars, MONDAY);
    expect(domain.start).toEqual(day('2026-10-03'));
    expect(diffInDays(domain.start, domain.end) + 1).toBe(MIN_DOMAIN_DAYS);
  });
});

describe('fitTimeline', () => {
  // 19 days of content, as in a short release project.
  const content = { start: day('2026-09-25'), end: day('2026-10-13') };

  it('stretches month view so a short project fills the pane instead of padding out the calendar', () => {
    const fit = fitTimeline({ content, zoom: 'month', availableWidth: 1400 });
    // Whole months around the content, not most of a year.
    expect(fit.start).toEqual(day('2026-09-01'));
    expect(fit.end.getTime()).toBeLessThanOrEqual(day('2026-11-30').getTime());
    expect(fit.dayWidth).toBeGreaterThan(4);
    expect(fit.dayWidth).toBeLessThanOrEqual(16 * 1.35);
    expect((diffInDays(fit.start, fit.end) + 1) * fit.dayWidth).toBeGreaterThanOrEqual(1400 - 1);
  });

  it('keeps week view to whole weeks at a week-like scale', () => {
    const fit = fitTimeline({ content, zoom: 'week', availableWidth: 1400 });
    expect(fit.start.getDay()).toBe(1);
    expect(fit.end.getDay()).toBe(0);
    expect(fit.dayWidth).toBeLessThanOrEqual(26 * 1.35);
    expect(diffInDays(fit.start, fit.end) + 1).toBeLessThanOrEqual(63);
  });

  it('shrinks to the minimum scale and scrolls when the project is long', () => {
    const fit = fitTimeline({ content: { start: day('2026-01-10'), end: day('2027-06-20') }, zoom: 'month', availableWidth: 1400 });
    expect(fit.dayWidth).toBe(4);
    expect(fit.start).toEqual(day('2026-01-01'));
    expect(fit.end).toEqual(day('2027-06-30'));
  });

  it('leaves day view at a fixed scale', () => {
    expect(fitTimeline({ content, zoom: 'day', availableWidth: 1400 }).dayWidth).toBe(32);
    expect(fitTimeline({ content, zoom: 'day', availableWidth: 1400 }).start).toEqual(content.start);
  });

  it('falls back to the minimum scale before the pane has been measured', () => {
    expect(fitTimeline({ content, zoom: 'week', availableWidth: 0 }).dayWidth).toBe(11);
  });
});
