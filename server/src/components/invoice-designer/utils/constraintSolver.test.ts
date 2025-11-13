import { describe, expect, it } from 'vitest';

import { DESIGNER_CANVAS_BOUNDS } from '../constants/layout';
import type { DesignerConstraint, DesignerNode } from '../state/designerStore';
import { solveConstraints } from './constraintSolver';

const createNode = (overrides: Partial<DesignerNode>): DesignerNode => ({
  id: 'node-' + Math.random().toString(36).slice(2, 7),
  type: 'text',
  name: 'Text',
  position: { x: 0, y: 0 },
  size: { width: 100, height: 40 },
  ...overrides,
});

describe('constraintSolver', () => {
  it('keeps nodes within artboard bounds even without explicit constraints', () => {
    const nodes = [
      createNode({
        id: 'outside',
        position: { x: DESIGNER_CANVAS_BOUNDS.width + 50, y: DESIGNER_CANVAS_BOUNDS.height + 25 },
        size: { width: 200, height: 200 },
      }),
    ];

    const [solved] = solveConstraints(nodes, []);

    expect(solved.position.x).toBeLessThanOrEqual(DESIGNER_CANVAS_BOUNDS.width - 1);
    expect(solved.position.y).toBeLessThanOrEqual(DESIGNER_CANVAS_BOUNDS.height - 1);
  });

  it('honors simple alignment and dimension constraints', () => {
    const baseNodes: DesignerNode[] = [
      createNode({ id: 'a', position: { x: 120, y: 80 }, size: { width: 180, height: 60 } }),
      createNode({ id: 'b', position: { x: 260, y: 200 }, size: { width: 120, height: 40 } }),
    ];

    const constraints: DesignerConstraint[] = [
      { id: 'left-align', type: 'align-left', nodes: ['a', 'b'] },
      { id: 'match-width', type: 'match-width', nodes: ['a', 'b'] },
    ];

    const solved = solveConstraints(baseNodes, constraints);

    const nodeA = solved.find((node) => node.id === 'a');
    const nodeB = solved.find((node) => node.id === 'b');

    expect(nodeA && nodeB).toBeTruthy();
    if (!nodeA || !nodeB) return;

    expect(nodeA.position.x).toBeCloseTo(nodeB.position.x, 4);
    expect(nodeA.size.width).toBeCloseTo(nodeB.size.width, 4);
  });
});
