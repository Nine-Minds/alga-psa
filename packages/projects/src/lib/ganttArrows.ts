import type { GanttEdge } from './ganttSchedule';

export type Point = [number, number];

/** Distance between the parallel lanes arrows from different bars are spread over. */
export const LANE_GAP = 5;
const MAX_LANES = 5;

/**
 * Finish-to-start elbow as corner points. A successor that starts left of its
 * predecessor's end cannot be reached by a straight run, so the path drops into
 * the gutter between the two rows and doubles back.
 */
export function arrowPoints(params: {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  stub: number;
  rowHeight: number;
}): Point[] {
  const { x1, y1, x2, y2, stub, rowHeight } = params;
  if (y1 === y2) return [[x1, y1], [x2, y2]];
  if (x2 >= x1 + stub * 2) {
    return [[x1, y1], [x1 + stub, y1], [x1 + stub, y2], [x2, y2]];
  }
  const gutterY = y1 + (y2 >= y1 ? rowHeight / 2 : -rowHeight / 2);
  return [[x1, y1], [x1 + stub, y1], [x1 + stub, gutterY], [x2 - stub, gutterY], [x2 - stub, y2], [x2, y2]];
}

/** SVG path through the points with each corner rounded, clamped to the shorter adjoining leg. */
export function roundedPath(points: Point[], radius: number): string {
  if (points.length === 0) return '';
  let d = `M ${points[0][0]} ${points[0][1]}`;
  for (let i = 1; i < points.length - 1; i += 1) {
    const [px, py] = points[i - 1];
    const [cx, cy] = points[i];
    const [nx, ny] = points[i + 1];
    const inLength = Math.hypot(cx - px, cy - py);
    const outLength = Math.hypot(nx - cx, ny - cy);
    const r = Math.min(radius, inLength / 2, outLength / 2);
    if (r < 0.5) {
      d += ` L ${cx} ${cy}`;
      continue;
    }
    const ax = cx - ((cx - px) / inLength) * r;
    const ay = cy - ((cy - py) / inLength) * r;
    const bx = cx + ((nx - cx) / outLength) * r;
    const by = cy + ((ny - cy) / outLength) * r;
    d += ` L ${ax} ${ay} Q ${cx} ${cy} ${bx} ${by}`;
  }
  const last = points[points.length - 1];
  return points.length > 1 ? `${d} L ${last[0]} ${last[1]}` : d;
}

/**
 * Lane per source bar. Arrows leaving different bars that end at the same x
 * would otherwise turn at the same place and read as one line; arrows from the
 * same bar share a lane on purpose, as a fan-out.
 */
export function assignLanes(sources: { sourceId: string; x: number; y: number }[]): Map<string, number> {
  const lanes = new Map<string, number>();
  const byColumn = new Map<number, { sourceId: string; y: number }[]>();
  for (const source of sources) {
    if (lanes.has(source.sourceId)) continue;
    lanes.set(source.sourceId, 0);
    const column = Math.round(source.x / LANE_GAP);
    const list = byColumn.get(column);
    if (list) list.push(source);
    else byColumn.set(column, [source]);
  }
  for (const list of byColumn.values()) {
    list.sort((a, b) => a.y - b.y);
    list.forEach((source, index) => lanes.set(source.sourceId, index % MAX_LANES));
  }
  return lanes;
}

/**
 * Everything a task is tied to: all blocking work upstream and downstream of
 * it, plus its direct related links (related asserts no order, so it does not chain).
 */
export function dependencyChain(edges: GanttEdge[], taskId: string): { taskIds: Set<string>; edgeIds: Set<string> } {
  const taskIds = new Set<string>([taskId]);
  const edgeIds = new Set<string>();
  const blocks = edges.filter((edge) => edge.kind === 'blocks');

  const walk = (from: keyof GanttEdge, to: keyof GanttEdge) => {
    const stack = [taskId];
    const seen = new Set<string>([taskId]);
    while (stack.length > 0) {
      const current = stack.pop()!;
      for (const edge of blocks) {
        if (edge[from] !== current) continue;
        edgeIds.add(edge.dependencyId);
        const next = edge[to] as string;
        taskIds.add(next);
        if (!seen.has(next)) {
          seen.add(next);
          stack.push(next);
        }
      }
    }
  };
  walk('predecessorTaskId', 'successorTaskId');
  walk('successorTaskId', 'predecessorTaskId');

  for (const edge of edges) {
    if (edge.kind !== 'related') continue;
    if (edge.predecessorTaskId !== taskId && edge.successorTaskId !== taskId) continue;
    edgeIds.add(edge.dependencyId);
    taskIds.add(edge.predecessorTaskId);
    taskIds.add(edge.successorTaskId);
  }

  return { taskIds, edgeIds };
}
