import { describe, expect, it } from 'vitest';

import type { IProjectTaskDependency } from '@alga-psa/types';
import { collectGanttEdges } from './ganttSchedule';
import { addDependencyToMap, removeDependencyFromMap } from './taskDependencyMap';

const dependency = (id: string, from: string, to: string) =>
  ({ dependency_id: id, predecessor_task_id: from, successor_task_id: to, dependency_type: 'blocks', lead_lag_days: 0 }) as IProjectTaskDependency;

describe('addDependencyToMap', () => {
  it('lists the dependency under both tasks, creating entries that do not exist yet', () => {
    const map = addDependencyToMap({}, dependency('d1', 'a', 'b'));
    expect(map.a).toEqual({ predecessors: [], successors: [dependency('d1', 'a', 'b')] });
    expect(map.b).toEqual({ predecessors: [dependency('d1', 'a', 'b')], successors: [] });
  });

  it('keeps existing dependencies and does not mutate the input', () => {
    const before = addDependencyToMap({}, dependency('d1', 'a', 'b'));
    const snapshot = JSON.stringify(before);
    const after = addDependencyToMap(before, dependency('d2', 'b', 'c'));
    expect(JSON.stringify(before)).toBe(snapshot);
    expect(after.b.predecessors.map((d) => d.dependency_id)).toEqual(['d1']);
    expect(after.b.successors.map((d) => d.dependency_id)).toEqual(['d2']);
    // The timeline reads one arrow per dependency, however many entries list it.
    expect(collectGanttEdges(after).map((edge) => edge.dependencyId).sort()).toEqual(['d1', 'd2']);
  });
});

describe('removeDependencyFromMap', () => {
  it('removes the dependency from both tasks and leaves the others', () => {
    let map = addDependencyToMap({}, dependency('d1', 'a', 'b'));
    map = addDependencyToMap(map, dependency('d2', 'b', 'c'));
    const after = removeDependencyFromMap(map, 'd1');
    expect(after.a.successors).toEqual([]);
    expect(after.b.predecessors).toEqual([]);
    expect(after.b.successors.map((d) => d.dependency_id)).toEqual(['d2']);
    expect(collectGanttEdges(after).map((edge) => edge.dependencyId)).toEqual(['d2']);
  });

  it('is a no-op for an unknown id', () => {
    const map = addDependencyToMap({}, dependency('d1', 'a', 'b'));
    expect(removeDependencyFromMap(map, 'nope')).toEqual(map);
  });
});
