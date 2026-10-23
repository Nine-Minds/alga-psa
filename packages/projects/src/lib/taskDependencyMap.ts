import type { IProjectTaskDependency } from '@alga-psa/types';
import type { TaskDependencyMap } from './ganttSchedule';

/**
 * The per-task dependency map lists each dependency twice: under its
 * predecessor's `successors` and under its successor's `predecessors`.
 * These keep both sides in step when one is added or removed locally.
 */
export function addDependencyToMap(map: TaskDependencyMap, dependency: IProjectTaskDependency): TaskDependencyMap {
  const predecessorId = dependency.predecessor_task_id;
  const successorId = dependency.successor_task_id;
  const predecessorEntry = map[predecessorId] ?? { predecessors: [], successors: [] };
  // Read the successor's entry after the predecessor's is in place, so a
  // self-referencing row still ends up on both sides of one entry.
  const withPredecessor: TaskDependencyMap = {
    ...map,
    [predecessorId]: { ...predecessorEntry, successors: [...predecessorEntry.successors, dependency] },
  };
  const successorEntry = withPredecessor[successorId] ?? { predecessors: [], successors: [] };
  return {
    ...withPredecessor,
    [successorId]: { ...successorEntry, predecessors: [...successorEntry.predecessors, dependency] },
  };
}

export function removeDependencyFromMap(map: TaskDependencyMap, dependencyId: string): TaskDependencyMap {
  const next: TaskDependencyMap = {};
  for (const [taskId, entry] of Object.entries(map)) {
    next[taskId] = {
      predecessors: entry.predecessors.filter((dependency) => dependency.dependency_id !== dependencyId),
      successors: entry.successors.filter((dependency) => dependency.dependency_id !== dependencyId),
    };
  }
  return next;
}
