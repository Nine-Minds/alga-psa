import { describe, expect, it } from 'vitest';

import { arrowPoints, assignLanes, dependencyChain, roundedPath } from './ganttArrows';
import type { GanttEdge } from './ganttSchedule';

const edge = (from: string, to: string, kind: GanttEdge['kind'] = 'blocks'): GanttEdge => ({
  dependencyId: `${from}->${to}`,
  predecessorTaskId: from,
  successorTaskId: to,
  leadLagDays: 0,
  kind,
});

describe('arrowPoints', () => {
  it('turns once when the successor starts far enough to the right', () => {
    expect(arrowPoints({ x1: 100, y1: 18, x2: 200, y2: 90, stub: 10, rowHeight: 36 })).toEqual([
      [100, 18], [110, 18], [110, 90], [200, 90],
    ]);
  });

  it('doubles back through the row gutter when the successor starts to the left', () => {
    expect(arrowPoints({ x1: 100, y1: 18, x2: 60, y2: 90, stub: 10, rowHeight: 36 })).toEqual([
      [100, 18], [110, 18], [110, 36], [50, 36], [50, 90], [60, 90],
    ]);
  });

  it('uses the gutter above when the successor is in an earlier row', () => {
    expect(arrowPoints({ x1: 100, y1: 90, x2: 60, y2: 18, stub: 10, rowHeight: 36 })[2]).toEqual([110, 72]);
  });
});

describe('roundedPath', () => {
  it('rounds corners and ends exactly on the last point', () => {
    const d = roundedPath([[0, 0], [10, 0], [10, 20]], 4);
    expect(d).toBe('M 0 0 L 6 0 Q 10 0 10 4 L 10 20');
  });

  it('clamps the radius to half the shorter leg', () => {
    expect(roundedPath([[0, 0], [4, 0], [4, 20]], 6)).toBe('M 0 0 L 2 0 Q 4 0 4 2 L 4 20');
  });
});

describe('assignLanes', () => {
  it('separates different bars that end at the same x and keeps one lane per bar', () => {
    const lanes = assignLanes([
      { sourceId: 'a', x: 100, y: 18 },
      { sourceId: 'b', x: 101, y: 54 },
      { sourceId: 'a', x: 100, y: 18 },
      { sourceId: 'c', x: 300, y: 90 },
    ]);
    expect(lanes.get('a')).toBe(0);
    expect(lanes.get('b')).toBe(1);
    expect(lanes.get('c')).toBe(0);
  });
});

describe('dependencyChain', () => {
  const edges = [edge('a', 'b'), edge('b', 'c'), edge('c', 'd'), edge('x', 'c'), edge('b', 'r', 'related'), edge('q', 'z')];

  it('collects everything upstream and downstream through blocking links', () => {
    const chain = dependencyChain(edges, 'b');
    expect([...chain.taskIds].sort()).toEqual(['a', 'b', 'c', 'd', 'r']);
    expect([...chain.edgeIds].sort()).toEqual(['a->b', 'b->c', 'b->r', 'c->d']);
  });

  it('does not chain through related links or pull in sibling branches', () => {
    expect([...dependencyChain(edges, 'r').taskIds].sort()).toEqual(['b', 'r']);
    expect(dependencyChain(edges, 'd').taskIds.has('q')).toBe(false);
    // x feeds c, which is upstream of d, so it belongs to d's chain; it is not downstream of b.
    expect(dependencyChain(edges, 'd').taskIds.has('x')).toBe(true);
    expect(dependencyChain(edges, 'b').taskIds.has('x')).toBe(false);
  });

  it('survives a cycle in stale data', () => {
    expect(dependencyChain([edge('a', 'b'), edge('b', 'a')], 'a').taskIds.size).toBe(2);
  });
});
