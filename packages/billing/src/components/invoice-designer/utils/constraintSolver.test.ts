import { describe, expect, it } from 'vitest';

import { DESIGNER_CANVAS_BOUNDS } from '../constants/layout';
import type { DesignerConstraint, DesignerNode } from '../state/designerStore';
import { solveConstraints } from './constraintSolver';

const createNode = (overrides: Partial<DesignerNode>): DesignerNode => {
  const { parentId, childIds, allowedChildren, ...rest } = overrides;
  return {
    id: 'node-' + Math.random().toString(36).slice(2, 7),
    type: 'text',
    name: 'Text',
    position: { x: 0, y: 0 },
    size: { width: 100, height: 40 },
    baseSize: { width: 100, height: 40 },
    ...rest,
    parentId: parentId ?? null,
    childIds: childIds ?? [],
    allowedChildren: allowedChildren ?? [],
  };
};

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

  it('keeps child sizing stable when local coordinates exceed canvas width', () => {
    const bounds = { width: 816, height: 1056 };
    const document = createNode({
      id: 'document',
      type: 'document',
      size: { width: 1400, height: 1200 },
      allowedChildren: ['page'],
      childIds: ['page'],
    });
    const page = createNode({
      id: 'page',
      type: 'page',
      parentId: document.id,
      size: { width: 1400, height: 1000 },
      allowedChildren: ['section'],
      childIds: ['parent'],
    });
    const parent = createNode({
      id: 'parent',
      type: 'section',
      parentId: page.id,
      size: { width: 1400, height: 400 },
      childIds: ['child'],
    });
    const child = createNode({
      id: 'child',
      type: 'text',
      parentId: parent.id,
      position: { x: 1200, y: 32 },
      size: { width: 160, height: 60 },
    });

    const solved = solveConstraints([document, page, parent, child], [], bounds);
    const solvedChild = solved.find((node) => node.id === child.id);

    expect(solvedChild).toBeTruthy();
    if (!solvedChild) return;

    expect(solvedChild.size.width).toBeGreaterThan(1);
    expect(solvedChild.size.width).toBeCloseTo(160, 4);
    expect(solvedChild.position.x + solvedChild.size.width).toBeLessThanOrEqual(parent.size.width);
  });

  it('applies practical minimum sizes for field and signature nodes', () => {
    const document = createNode({
      id: 'document',
      type: 'document',
      size: { width: 816, height: 1056 },
      allowedChildren: ['page'],
      childIds: ['page'],
    });
    const page = createNode({
      id: 'page',
      type: 'page',
      parentId: document.id,
      size: { width: 816, height: 1056 },
      allowedChildren: ['section'],
      childIds: ['section'],
    });
    const section = createNode({
      id: 'section',
      type: 'section',
      parentId: page.id,
      size: { width: 640, height: 300 },
      childIds: ['field', 'signature'],
    });
    const field = createNode({
      id: 'field',
      type: 'field',
      parentId: section.id,
      position: { x: 24, y: 24 },
      size: { width: 1, height: 48 },
    });
    const signature = createNode({
      id: 'signature',
      type: 'signature',
      parentId: section.id,
      position: { x: 24, y: 96 },
      size: { width: 280, height: 1 },
    });

    const solved = solveConstraints([document, page, section, field, signature], []);
    const solvedField = solved.find((node) => node.id === 'field');
    const solvedSignature = solved.find((node) => node.id === 'signature');

    expect(solvedField).toBeTruthy();
    expect(solvedSignature).toBeTruthy();
    if (!solvedField || !solvedSignature) return;

    expect(solvedField.size.width).toBeGreaterThanOrEqual(120);
    expect(solvedField.size.height).toBeGreaterThanOrEqual(40);
    expect(solvedSignature.size.width).toBeGreaterThanOrEqual(180);
    expect(solvedSignature.size.height).toBeGreaterThanOrEqual(96);
  });
});
