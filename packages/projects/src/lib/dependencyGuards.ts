import type { IProjectPhase, IProjectTask, ProjectStatus } from '@alga-psa/types';
import { findViolatedEdges, scheduleGanttBars, type GanttEdge } from './ganttSchedule';

export interface TaskChange {
  start_date?: Date | string | null;
  due_date?: Date | string | null;
  project_status_mapping_id?: string;
}

export type DependencyWarning =
  /** Moving a task forward while something it waits on is still open. */
  | { kind: 'blocked-status'; taskName: string; statusName: string; blockerNames: string[] }
  /** New dates start the task before a blocker is due to finish. */
  | { kind: 'starts-before-blocker'; taskName: string; otherTaskName: string }
  /** New dates finish the task after something waiting on it is due to start. */
  | { kind: 'ends-after-dependent'; taskName: string; otherTaskName: string };

interface GuardContext {
  tasks: IProjectTask[];
  phases: IProjectPhase[];
  edges: GanttEdge[];
  /** Every status mapping in the project, across phases. */
  statuses: ProjectStatus[];
  today?: Date;
}

const sameDay = (a: Date | string | null | undefined, b: Date | string | null | undefined) =>
  (a ? new Date(a).getTime() : null) === (b ? new Date(b).getTime() : null);

/**
 * Dependencies are advisory, so nothing here blocks a save. This lists what a
 * change would newly contradict, for the caller to confirm with the user.
 * Conflicts that already existed before the change are not reported again.
 */
export function dependencyWarnings(
  context: GuardContext,
  changes: Array<{ taskId: string; change: TaskChange }>,
): DependencyWarning[] {
  const { tasks, phases, edges, statuses, today } = context;
  const taskById = new Map(tasks.map((task) => [task.task_id, task]));
  const statusById = new Map(statuses.map((status) => [status.project_status_mapping_id, status]));
  const isClosed = (task: IProjectTask) => statusById.get(task.project_status_mapping_id)?.is_closed ?? false;
  const warnings: DependencyWarning[] = [];

  for (const { taskId, change } of changes) {
    const task = taskById.get(taskId);
    if (!task) continue;

    const targetStatusId = change.project_status_mapping_id;
    if (targetStatusId && targetStatusId !== task.project_status_mapping_id) {
      const current = statusById.get(task.project_status_mapping_id);
      const target = statusById.get(targetStatusId);
      // Only forward moves start or finish work; sending a task back is always fine.
      const forward =
        Boolean(target) && (target!.is_closed || (target!.display_order ?? 0) > (current?.display_order ?? 0));
      if (forward) {
        const blockerNames = edges
          .filter((edge) => edge.kind === 'blocks' && edge.successorTaskId === taskId)
          .map((edge) => taskById.get(edge.predecessorTaskId))
          .filter((blocker): blocker is IProjectTask => Boolean(blocker) && !isClosed(blocker!))
          .map((blocker) => blocker.task_name);
        if (blockerNames.length > 0) {
          warnings.push({
            kind: 'blocked-status',
            taskName: task.task_name,
            statusName: target!.custom_name || target!.name,
            blockerNames,
          });
        }
      }
    }

    const startChanged = 'start_date' in change && !sameDay(change.start_date, task.start_date);
    const dueChanged = 'due_date' in change && !sameDay(change.due_date, task.due_date);
    if (!startChanged && !dueChanged) continue;

    const next: IProjectTask = {
      ...task,
      start_date: 'start_date' in change ? (change.start_date ? new Date(change.start_date) : null) : task.start_date,
      due_date: 'due_date' in change ? (change.due_date ? new Date(change.due_date) : null) : task.due_date,
    };
    const before = findViolatedEdges(edges, scheduleGanttBars({ tasks, phases, edges, today }));
    const after = findViolatedEdges(
      edges,
      scheduleGanttBars({ tasks: tasks.map((t) => (t.task_id === taskId ? next : t)), phases, edges, today }),
    );
    for (const edge of edges) {
      if (!after.has(edge.dependencyId) || before.has(edge.dependencyId)) continue;
      if (edge.successorTaskId === taskId) {
        const other = taskById.get(edge.predecessorTaskId);
        if (other) warnings.push({ kind: 'starts-before-blocker', taskName: task.task_name, otherTaskName: other.task_name });
      } else if (edge.predecessorTaskId === taskId) {
        const other = taskById.get(edge.successorTaskId);
        if (other) warnings.push({ kind: 'ends-after-dependent', taskName: task.task_name, otherTaskName: other.task_name });
      }
    }
  }

  return warnings;
}
