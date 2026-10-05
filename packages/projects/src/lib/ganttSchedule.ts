import type { IProjectPhase, IProjectTask, IProjectTaskDependency } from '@alga-psa/types';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Minutes of estimated work that fill one working day on the chart. */
export const MINUTES_PER_WORK_DAY = 8 * 60;

/** Bar length for a task carrying no estimate. */
export const DEFAULT_TASK_DURATION_DAYS = 1;

export interface GanttEdge {
  dependencyId: string;
  predecessorTaskId: string;
  successorTaskId: string;
  leadLagDays: number;
  /** Only 'blocks' moves bars; 'related' is drawn but never scheduled. */
  kind: 'blocks' | 'related';
}

export interface GanttBar {
  taskId: string;
  start: Date;
  end: Date;
  /** Dates the user entered render solid; inferred ones render hatched. */
  derivedStart: boolean;
  derivedEnd: boolean;
}

export type TaskDependencyMap = Record<
  string,
  { predecessors: IProjectTaskDependency[]; successors: IProjectTaskDependency[] }
>;

export function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

export function diffInDays(from: Date, to: Date): number {
  return Math.round((startOfDay(to).getTime() - startOfDay(from).getTime()) / MS_PER_DAY);
}

/** Estimates are spent on working days; Saturday and Sunday carry no work. */
export function isWorkingDay(date: Date): boolean {
  const weekday = date.getDay();
  return weekday !== 0 && weekday !== 6;
}

export function nextWorkingDay(date: Date): Date {
  let d = startOfDay(date);
  while (!isWorkingDay(d)) d = addDays(d, 1);
  return d;
}

/** Last day of a span that starts on `start` and covers `workingDays` working days. */
export function addWorkingDays(start: Date, workingDays: number): Date {
  let d = nextWorkingDay(start);
  for (let remaining = Math.max(1, workingDays) - 1; remaining > 0; ) {
    d = addDays(d, 1);
    if (isWorkingDay(d)) remaining -= 1;
  }
  return d;
}

/** First day of a span that ends on `end` and covers `workingDays` working days. */
export function subtractWorkingDays(end: Date, workingDays: number): Date {
  let d = startOfDay(end);
  while (!isWorkingDay(d)) d = addDays(d, -1);
  for (let remaining = Math.max(1, workingDays) - 1; remaining > 0; ) {
    d = addDays(d, -1);
    if (isWorkingDay(d)) remaining -= 1;
  }
  return d;
}

/**
 * Flatten the per-task dependency map into a unique edge list. Both kinds are
 * returned so the chart can draw them, but only `blocks` is fed to the
 * scheduler — `related_to` asserts no ordering, so it must never move a bar.
 */
export function collectGanttEdges(taskDependencies: TaskDependencyMap): GanttEdge[] {
  const byDependencyId = new Map<string, GanttEdge>();

  for (const entry of Object.values(taskDependencies ?? {})) {
    for (const dep of [...(entry?.predecessors ?? []), ...(entry?.successors ?? [])]) {
      const type = dep.dependency_type;
      if (type !== 'blocks' && type !== 'blocked_by' && type !== 'related_to') continue;
      // New rows are stored as 'blocks', but editing a dependency's type can leave
      // a 'blocked_by' row: "A blocked_by B" means B must finish first, so flip it.
      const flipped = type === 'blocked_by';
      byDependencyId.set(dep.dependency_id, {
        dependencyId: dep.dependency_id,
        predecessorTaskId: flipped ? dep.successor_task_id : dep.predecessor_task_id,
        successorTaskId: flipped ? dep.predecessor_task_id : dep.successor_task_id,
        leadLagDays: Number(dep.lead_lag_days) || 0,
        kind: type === 'related_to' ? 'related' : 'blocks',
      });
    }
  }

  return [...byDependencyId.values()];
}

function durationDaysFor(task: IProjectTask): number {
  const minutes = Number(task.estimated_hours);
  if (!Number.isFinite(minutes) || minutes <= 0) return DEFAULT_TASK_DURATION_DAYS;
  return Math.max(1, Math.ceil(minutes / MINUTES_PER_WORK_DAY));
}

/**
 * Earliest day a successor may start: the day after its predecessor ends,
 * shifted by lead/lag (positive lags, negative leads pull it earlier). This is
 * the only place lead_lag_days has ever been read.
 */
function earliestStartAfter(predecessorEnd: Date, leadLagDays: number): Date {
  return addDays(predecessorEnd, 1 + leadLagDays);
}

/** Same hand-off, pushed past a weekend — where an inferred bar actually lands. */
function earliestWorkingStartAfter(predecessorEnd: Date, leadLagDays: number): Date {
  return nextWorkingDay(earliestStartAfter(predecessorEnd, leadLagDays));
}

/**
 * Lay every task on a calendar. Entered dates win; anything missing is inferred
 * by walking the blocks-DAG forward from the phase start, so a project with no
 * dates at all still produces a readable chart.
 */
export function scheduleGanttBars(params: {
  tasks: IProjectTask[];
  phases: IProjectPhase[];
  edges: GanttEdge[];
  today?: Date;
}): Map<string, GanttBar> {
  const { tasks, phases } = params;
  const edges = params.edges.filter((edge) => edge.kind === 'blocks');
  const today = startOfDay(params.today ?? new Date());

  const taskById = new Map(tasks.map((task) => [task.task_id, task]));
  const phaseById = new Map(phases.map((phase) => [phase.phase_id, phase]));

  const incoming = new Map<string, GanttEdge[]>();
  const outgoing = new Map<string, GanttEdge[]>();
  const indegree = new Map<string, number>(tasks.map((task) => [task.task_id, 0]));

  const push = (map: Map<string, GanttEdge[]>, key: string, edge: GanttEdge) => {
    const list = map.get(key);
    if (list) list.push(edge);
    else map.set(key, [edge]);
  };

  for (const edge of edges) {
    if (!taskById.has(edge.predecessorTaskId) || !taskById.has(edge.successorTaskId)) continue;
    push(incoming, edge.successorTaskId, edge);
    push(outgoing, edge.predecessorTaskId, edge);
    indegree.set(edge.successorTaskId, (indegree.get(edge.successorTaskId) ?? 0) + 1);
  }

  const byWbs = (a: IProjectTask, b: IProjectTask) => (a.wbs_code || '').localeCompare(b.wbs_code || '');
  const queue = tasks.filter((task) => (indegree.get(task.task_id) ?? 0) === 0).sort(byWbs);
  const ordered: IProjectTask[] = [];
  const settled = new Set<string>();

  while (queue.length > 0) {
    const task = queue.shift()!;
    if (settled.has(task.task_id)) continue;
    settled.add(task.task_id);
    ordered.push(task);

    for (const edge of outgoing.get(task.task_id) ?? []) {
      const remaining = (indegree.get(edge.successorTaskId) ?? 0) - 1;
      indegree.set(edge.successorTaskId, remaining);
      if (remaining === 0) {
        const successor = taskById.get(edge.successorTaskId);
        if (successor) queue.push(successor);
      }
    }
  }

  // A cycle should be impossible (addDependency validates), but stale rows must
  // not drop tasks off the chart — schedule them from their phase instead.
  for (const task of tasks) {
    if (!settled.has(task.task_id)) ordered.push(task);
  }

  const bars = new Map<string, GanttBar>();

  for (const task of ordered) {
    const explicitStart = task.start_date ? startOfDay(new Date(task.start_date)) : null;
    const explicitEnd = task.due_date ? startOfDay(new Date(task.due_date)) : null;
    const duration = durationDaysFor(task);

    let chainStart: Date | null = null;
    for (const edge of incoming.get(task.task_id) ?? []) {
      const predecessor = bars.get(edge.predecessorTaskId);
      if (!predecessor) continue;
      const candidate = earliestWorkingStartAfter(predecessor.end, edge.leadLagDays);
      if (!chainStart || candidate > chainStart) chainStart = candidate;
    }

    const phase = phaseById.get(task.phase_id);
    const phaseStart = phase?.start_date ? startOfDay(new Date(phase.start_date)) : null;

    let start: Date;
    let derivedStart = false;
    if (explicitStart) {
      start = explicitStart;
    } else {
      derivedStart = true;
      const earliest = nextWorkingDay(chainStart ?? phaseStart ?? today);
      // A due date on its own describes a span, not a point: run the bar from
      // the earliest day the task could begin up to the date it is due, rather
      // than collapsing it onto the due date as a one-day block.
      if (explicitEnd) {
        start = earliest <= explicitEnd ? earliest : subtractWorkingDays(explicitEnd, duration);
      } else {
        start = earliest;
      }
    }

    let end: Date;
    let derivedEnd = false;
    if (explicitEnd) {
      end = explicitEnd;
    } else {
      derivedEnd = true;
      end = addWorkingDays(start, duration);
    }

    // A due date earlier than the start (bad data, or a date the chain has
    // already overrun) collapses to a single day rather than a negative bar.
    if (end < start) end = start;

    bars.set(task.task_id, { taskId: task.task_id, start, end, derivedStart, derivedEnd });
  }

  return bars;
}

/**
 * Dependencies the entered dates contradict — the successor starts before its
 * predecessor can hand off. Inferred bars are scheduled on or after the earliest
 * legal day, so only user-entered dates ever land here.
 */
export function findViolatedEdges(edges: GanttEdge[], bars: Map<string, GanttBar>): Set<string> {
  const violated = new Set<string>();

  for (const edge of edges) {
    if (edge.kind !== 'blocks') continue;
    const predecessor = bars.get(edge.predecessorTaskId);
    const successor = bars.get(edge.successorTaskId);
    if (!predecessor || !successor) continue;
    if (successor.start < earliestStartAfter(predecessor.end, edge.leadLagDays)) {
      violated.add(edge.dependencyId);
    }
  }

  return violated;
}

/** Smallest span the chart will draw, so a dateless project is still readable. */
export const MIN_DOMAIN_DAYS = 21;

/** Chart domain, padded so bars never butt against the edges. */
export function ganttDomain(bars: Map<string, GanttBar>, today?: Date): { start: Date; end: Date } {
  const now = startOfDay(today ?? new Date());
  let min: Date | null = null;
  let max: Date | null = null;

  for (const bar of bars.values()) {
    if (!min || bar.start < min) min = bar.start;
    if (!max || bar.end > max) max = bar.end;
  }

  if (!min || !max) return { start: addDays(now, -7), end: addDays(now, MIN_DOMAIN_DAYS) };

  const start = addDays(min, -2);
  const end = addDays(max, 2);
  // Every task landing on one day would otherwise give a 5-day axis.
  const span = diffInDays(start, end) + 1;
  return { start, end: span >= MIN_DOMAIN_DAYS ? end : addDays(start, MIN_DOMAIN_DAYS - 1) };
}

/**
 * The chain of blocking tasks that sets the project's finish date: walk back
 * from the latest-ending task through every hand-off that leaves no slack.
 * Delaying any task on it delays the finish.
 */
export function findCriticalPath(
  edges: GanttEdge[],
  bars: Map<string, GanttBar>,
): { taskIds: Set<string>; edgeIds: Set<string> } {
  const taskIds = new Set<string>();
  const edgeIds = new Set<string>();

  let finish: Date | null = null;
  for (const bar of bars.values()) {
    if (!finish || bar.end > finish) finish = bar.end;
  }
  if (!finish) return { taskIds, edgeIds };

  const incoming = new Map<string, GanttEdge[]>();
  for (const edge of edges) {
    if (edge.kind !== 'blocks') continue;
    const list = incoming.get(edge.successorTaskId);
    if (list) list.push(edge);
    else incoming.set(edge.successorTaskId, [edge]);
  }

  const stack: string[] = [];
  for (const bar of bars.values()) {
    if (bar.end.getTime() === finish.getTime()) stack.push(bar.taskId);
  }

  while (stack.length > 0) {
    const taskId = stack.pop()!;
    if (taskIds.has(taskId)) continue;
    taskIds.add(taskId);

    const successor = bars.get(taskId);
    if (!successor) continue;
    for (const edge of incoming.get(taskId) ?? []) {
      const predecessor = bars.get(edge.predecessorTaskId);
      if (!predecessor) continue;
      if (successor.start <= earliestWorkingStartAfter(predecessor.end, edge.leadLagDays)) {
        edgeIds.add(edge.dependencyId);
        stack.push(edge.predecessorTaskId);
      }
    }
  }

  return { taskIds, edgeIds };
}

/**
 * Share of a task that is done, 0..1. A closed task is complete; otherwise the
 * checklist is the most deliberate signal, then logged time against the estimate.
 */
export function taskProgress(params: {
  task: IProjectTask;
  closed: boolean;
  checklist?: { total: number; completed: number };
}): number {
  const { task, closed, checklist } = params;
  if (closed) return 1;
  if (checklist && checklist.total > 0) return Math.min(1, checklist.completed / checklist.total);
  const estimated = Number(task.estimated_hours);
  const actual = Number(task.actual_hours);
  if (Number.isFinite(estimated) && estimated > 0 && Number.isFinite(actual) && actual > 0) {
    return Math.min(1, actual / estimated);
  }
  return 0;
}

/**
 * Dates to persist after a bar is dragged. Moving pins both ends (an inferred
 * bar becomes a dated one); resizing changes only the dragged edge and never
 * crosses the other one.
 */
export function applyBarDrag(
  bar: GanttBar,
  mode: 'move' | 'resize-start' | 'resize-end',
  deltaDays: number,
): { start: Date; end: Date } {
  if (mode === 'move') return { start: addDays(bar.start, deltaDays), end: addDays(bar.end, deltaDays) };
  if (mode === 'resize-start') {
    const start = addDays(bar.start, deltaDays);
    return { start: start > bar.end ? bar.end : start, end: bar.end };
  }
  const end = addDays(bar.end, deltaDays);
  return { start: bar.start, end: end < bar.start ? bar.start : end };
}

export type TimelineZoom = 'day' | 'week' | 'month';

/**
 * Pixels per day. Day view is fixed. Week and month views stretch from `min`
 * up to `max` so a short project fills the pane instead of sitting in a corner
 * of an otherwise empty calendar; `max` keeps them from turning into day view.
 */
export const DAY_WIDTH_RANGE: Record<TimelineZoom, { min: number; max: number }> = {
  day: { min: 32, max: 32 },
  week: { min: 11, max: 26 },
  month: { min: 4, max: 16 },
};

const MAX_OVERSTRETCH = 1.35;

/** Whole weeks (Mon-Sun) or whole months, so header cells are never cut. */
function snapToZoom(range: { start: Date; end: Date }, zoom: TimelineZoom): { start: Date; end: Date } {
  if (zoom === 'week') {
    const start = addDays(range.start, -((range.start.getDay() + 6) % 7));
    const end = addDays(range.end, (7 - range.end.getDay()) % 7);
    return { start, end };
  }
  if (zoom === 'month') {
    return {
      start: new Date(range.start.getFullYear(), range.start.getMonth(), 1),
      end: new Date(range.end.getFullYear(), range.end.getMonth() + 1, 0),
    };
  }
  return range;
}

/**
 * The visible range and scale for a pane `availableWidth` pixels wide. The
 * content is shown at the widest scale that still fits; only when it is too
 * short to fill the pane even at that scale is the range extended to the right.
 */
export function fitTimeline(params: {
  content: { start: Date; end: Date };
  zoom: TimelineZoom;
  availableWidth: number;
}): { start: Date; end: Date; dayWidth: number } {
  const { zoom, availableWidth } = params;
  const { min, max } = DAY_WIDTH_RANGE[zoom];
  const snapped = snapToZoom(params.content, zoom);
  const span = diffInDays(snapped.start, snapped.end) + 1;
  if (availableWidth <= 0) return { ...snapped, dayWidth: min };

  // A small shortfall is closed by stretching a little past `max`; padding the
  // range instead would add a whole extra week or month for a few pixels.
  const exact = availableWidth / span;
  const dayWidth = exact <= max * MAX_OVERSTRETCH ? Math.max(min, exact) : max;
  if (span * dayWidth >= availableWidth - 0.5) return { ...snapped, dayWidth };

  const padded = snapToZoom(
    { start: snapped.start, end: addDays(snapped.start, Math.ceil(availableWidth / dayWidth) - 1) },
    zoom,
  );
  return { ...padded, dayWidth };
}
