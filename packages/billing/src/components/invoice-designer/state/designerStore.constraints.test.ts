import { beforeEach, describe, expect, it } from 'vitest';

import type { DesignerConstraint, DesignerNode } from './designerStore';
import { useInvoiceDesignerStore } from './designerStore';
import { buildPairConstraint } from '../utils/constraints';

const createNode = (overrides: Partial<DesignerNode>): DesignerNode => ({
  id: overrides.id ?? `node-${Math.random().toString(36).slice(2, 7)}`,
  type: overrides.type ?? 'text',
  name: overrides.name ?? 'Node',
  position: overrides.position ?? { x: 0, y: 0 },
  size: overrides.size ?? { width: 120, height: 48 },
  baseSize: overrides.baseSize ?? overrides.size ?? { width: 120, height: 48 },
  canRotate: overrides.canRotate ?? false,
  allowResize: overrides.allowResize ?? true,
  rotation: overrides.rotation ?? 0,
  metadata: overrides.metadata ?? {},
  layoutPresetId: overrides.layoutPresetId,
  layout:
    overrides.layout ?? {
      mode: 'canvas',
      direction: 'column',
      gap: 0,
      padding: 0,
      justify: 'start',
      align: 'start',
      sizing: 'fixed',
    },
  parentId: overrides.parentId ?? null,
  childIds: overrides.childIds ?? [],
  allowedChildren: overrides.allowedChildren ?? [],
});

const seedWorkspace = (constraints: DesignerConstraint[] = []) => {
  const doc = createNode({
    id: 'doc',
    type: 'document',
    size: { width: 816, height: 1056 },
    baseSize: { width: 816, height: 1056 },
    allowResize: false,
    canRotate: false,
    childIds: ['page'],
    allowedChildren: ['page'],
  });
  const page = createNode({
    id: 'page',
    type: 'page',
    parentId: 'doc',
    size: { width: 816, height: 1056 },
    baseSize: { width: 816, height: 1056 },
    allowResize: false,
    canRotate: false,
    childIds: ['section-a', 'section-b'],
    allowedChildren: ['section'],
  });
  const sectionA = createNode({
    id: 'section-a',
    type: 'section',
    parentId: 'page',
    position: { x: 40, y: 40 },
    size: { width: 640, height: 220 },
    baseSize: { width: 640, height: 220 },
    childIds: ['field-a', 'field-b', 'image-a'],
    allowedChildren: ['field', 'label', 'image', 'container'],
  });
  const sectionB = createNode({
    id: 'section-b',
    type: 'section',
    parentId: 'page',
    position: { x: 40, y: 300 },
    size: { width: 640, height: 220 },
    baseSize: { width: 640, height: 220 },
    childIds: ['field-c'],
    allowedChildren: ['field', 'label', 'container'],
  });
  const fieldA = createNode({
    id: 'field-a',
    type: 'field',
    parentId: 'section-a',
    position: { x: 24, y: 24 },
    size: { width: 200, height: 48 },
    baseSize: { width: 200, height: 48 },
  });
  const fieldB = createNode({
    id: 'field-b',
    type: 'field',
    parentId: 'section-a',
    position: { x: 240, y: 120 },
    size: { width: 180, height: 48 },
    baseSize: { width: 180, height: 48 },
  });
  const fieldC = createNode({
    id: 'field-c',
    type: 'field',
    parentId: 'section-b',
    position: { x: 24, y: 24 },
    size: { width: 180, height: 48 },
    baseSize: { width: 180, height: 48 },
  });
  const imageA = createNode({
    id: 'image-a',
    type: 'image',
    parentId: 'section-a',
    position: { x: 420, y: 24 },
    size: { width: 180, height: 120 },
    baseSize: { width: 180, height: 120 },
  });

  useInvoiceDesignerStore.getState().loadWorkspace({
    nodes: [doc, page, sectionA, sectionB, fieldA, fieldB, fieldC, imageA],
    constraints,
    snapToGrid: true,
    gridSize: 8,
    showGuides: true,
    showRulers: true,
    canvasScale: 1,
  });
};

const getPairConstraint = (type: Extract<DesignerConstraint, { nodes: [string, string] }>['type']) =>
  useInvoiceDesignerStore.getState().constraints.find((constraint) => constraint.type === type);

describe('designerStore pair constraints', () => {
  beforeEach(() => {
    useInvoiceDesignerStore.getState().resetWorkspace();
    seedWorkspace();
  });

  it('defaults newly-authored pair constraints to strong strength', () => {
    useInvoiceDesignerStore.getState().addConstraint({
      id: 'custom',
      type: 'align-left',
      nodes: ['field-a', 'field-b'],
    });
    const constraint = getPairConstraint('align-left');
    expect(constraint).toBeTruthy();
    if (!constraint || constraint.type === 'aspect-ratio') return;
    expect(constraint.strength).toBe('strong');
  });

  it('blocks duplicate constraints for same ordered and reversed node pairs', () => {
    const store = useInvoiceDesignerStore.getState();
    store.addConstraint({ id: 'one', type: 'align-left', nodes: ['field-a', 'field-b'] });
    store.addConstraint({ id: 'two', type: 'align-left', nodes: ['field-a', 'field-b'] });
    store.addConstraint({ id: 'three', type: 'align-left', nodes: ['field-b', 'field-a'] });

    const alignLeftConstraints = useInvoiceDesignerStore
      .getState()
      .constraints.filter((constraint) => constraint.type === 'align-left');
    expect(alignLeftConstraints.length).toBe(1);
  });

  it('blocks invalid pair combinations (self, cross-parent, missing)', () => {
    const store = useInvoiceDesignerStore.getState();
    store.addConstraint({ id: 'self', type: 'align-top', nodes: ['field-a', 'field-a'] });
    store.addConstraint({ id: 'cross-parent', type: 'align-top', nodes: ['field-a', 'field-c'] });
    store.addConstraint({ id: 'missing', type: 'align-top', nodes: ['field-a', 'missing'] });

    expect(useInvoiceDesignerStore.getState().constraints.length).toBe(0);
    expect(useInvoiceDesignerStore.getState().constraintError).toBeTruthy();
  });

  it('removing a pair constraint releases the relationship on subsequent edits', () => {
    const store = useInvoiceDesignerStore.getState();
    store.addConstraint({ id: 'mw', type: 'match-width', nodes: ['field-a', 'field-b'] });
    const matchWidth = getPairConstraint('match-width');
    if (!matchWidth || matchWidth.type === 'aspect-ratio') return;

    store.updateNodeSize('field-a', { width: 260, height: 48 }, true);
    const constrainedA = useInvoiceDesignerStore.getState().nodes.find((node) => node.id === 'field-a');
    const constrainedB = useInvoiceDesignerStore.getState().nodes.find((node) => node.id === 'field-b');
    expect(constrainedA?.size.width).toBeCloseTo(constrainedB?.size.width ?? 0, 2);

    store.removeConstraint(matchWidth.id);
    store.updateNodeSize('field-a', { width: 320, height: 48 }, true);
    const releasedA = useInvoiceDesignerStore.getState().nodes.find((node) => node.id === 'field-a');
    const releasedB = useInvoiceDesignerStore.getState().nodes.find((node) => node.id === 'field-b');
    expect(releasedA?.size.width).not.toBeCloseTo(releasedB?.size.width ?? 0, 2);
  });

  it('supports undo/redo around add and remove constraint operations', () => {
    const store = useInvoiceDesignerStore.getState();
    const beforeAddX = useInvoiceDesignerStore.getState().nodes.find((node) => node.id === 'field-b')?.position.x ?? 0;

    store.addConstraint({ id: 'al', type: 'align-left', nodes: ['field-a', 'field-b'] });
    const afterAdd = useInvoiceDesignerStore.getState();
    const alignedB = afterAdd.nodes.find((node) => node.id === 'field-b');
    const alignedA = afterAdd.nodes.find((node) => node.id === 'field-a');
    expect(alignedB?.position.x).toBeCloseTo(alignedA?.position.x ?? 0, 2);

    store.undo();
    const afterUndo = useInvoiceDesignerStore.getState();
    expect(afterUndo.constraints.some((constraint) => constraint.type === 'align-left')).toBe(false);
    const undoB = afterUndo.nodes.find((node) => node.id === 'field-b');
    expect(undoB?.position.x).toBeCloseTo(beforeAddX, 2);

    store.redo();
    const afterRedo = useInvoiceDesignerStore.getState();
    expect(afterRedo.constraints.some((constraint) => constraint.type === 'align-left')).toBe(true);
    const redoB = afterRedo.nodes.find((node) => node.id === 'field-b');
    const redoA = afterRedo.nodes.find((node) => node.id === 'field-a');
    expect(redoB?.position.x).toBeCloseTo(redoA?.position.x ?? 0, 2);

    const alignLeft = afterRedo.constraints.find((constraint) => constraint.type === 'align-left');
    if (!alignLeft) return;
    store.removeConstraint(alignLeft.id);
    expect(useInvoiceDesignerStore.getState().constraints.some((constraint) => constraint.type === 'align-left')).toBe(
      false
    );
    store.undo();
    expect(useInvoiceDesignerStore.getState().constraints.some((constraint) => constraint.type === 'align-left')).toBe(
      true
    );
  });

  it('exports and rehydrates pair constraints through workspace APIs', () => {
    const store = useInvoiceDesignerStore.getState();
    store.addConstraint({ id: 'mw', type: 'match-width', nodes: ['field-a', 'field-b'] });
    const exported = store.exportWorkspace();
    const exportedPair = exported.constraints.find((constraint) => constraint.type === 'match-width');
    expect(exportedPair).toBeTruthy();

    useInvoiceDesignerStore.getState().resetWorkspace();
    useInvoiceDesignerStore.getState().loadWorkspace(exported);
    const hydrated = useInvoiceDesignerStore.getState();
    expect(hydrated.constraints.some((constraint) => constraint.type === 'match-width')).toBe(true);
    const widthA = hydrated.nodes.find((node) => node.id === 'field-a')?.size.width ?? 0;
    const widthB = hydrated.nodes.find((node) => node.id === 'field-b')?.size.width ?? 0;
    expect(widthA).toBeCloseTo(widthB, 2);
  });

  it('keeps aligned relationships after move/resize updates', () => {
    const store = useInvoiceDesignerStore.getState();
    store.addConstraint({ id: 'al', type: 'align-left', nodes: ['field-a', 'field-b'] });
    store.moveNode('field-a', { x: 80, y: 0 }, true);
    const movedA = useInvoiceDesignerStore.getState().nodes.find((node) => node.id === 'field-a');
    const movedB = useInvoiceDesignerStore.getState().nodes.find((node) => node.id === 'field-b');
    expect(movedA?.position.x).toBeCloseTo(movedB?.position.x ?? 0, 2);

    store.addConstraint({ id: 'mw', type: 'match-width', nodes: ['field-a', 'field-b'] });
    store.updateNodeSize('field-a', { width: 260, height: 48 }, true);
    const resizedA = useInvoiceDesignerStore.getState().nodes.find((node) => node.id === 'field-a');
    const resizedB = useInvoiceDesignerStore.getState().nodes.find((node) => node.id === 'field-b');
    expect(resizedA?.size.width).toBeCloseTo(resizedB?.size.width ?? 0, 2);
  });

  it('allows aspect-ratio and pair constraints to coexist on separate nodes', () => {
    const store = useInvoiceDesignerStore.getState();
    store.toggleAspectRatioLock('image-a');
    store.addConstraint({ id: 'al', type: 'align-left', nodes: ['field-a', 'field-b'] });

    store.updateNodeSize('image-a', { width: 300, height: 300 }, true);
    const image = useInvoiceDesignerStore.getState().nodes.find((node) => node.id === 'image-a');
    expect(image).toBeTruthy();
    if (!image) return;

    const ratio = image.size.width / image.size.height;
    expect(ratio).toBeCloseTo(1.5, 1);
    expect(
      useInvoiceDesignerStore
        .getState()
        .constraints.some((constraint) => constraint.type === 'align-left')
    ).toBe(true);
    expect(
      useInvoiceDesignerStore
        .getState()
        .constraints.some((constraint) => constraint.type === 'aspect-ratio' && constraint.nodeId === 'image-a')
    ).toBe(true);
  });

  it('auto-prunes dangling constraints on delete and workspace hydration', () => {
    const store = useInvoiceDesignerStore.getState();
    store.addConstraint({ id: 'al', type: 'align-left', nodes: ['field-a', 'field-b'] });
    store.selectNode('field-a');
    store.deleteSelectedNode();
    expect(useInvoiceDesignerStore.getState().constraints.length).toBe(0);

    seedWorkspace([
      buildPairConstraint('align-left', 'field-a', 'field-b'),
      {
        id: 'bad',
        type: 'align-top',
        nodes: ['field-a', 'missing'],
      },
    ]);
    expect(useInvoiceDesignerStore.getState().constraints.length).toBe(1);
    expect(useInvoiceDesignerStore.getState().constraints[0]?.id).toBe(
      buildPairConstraint('align-left', 'field-a', 'field-b').id
    );
  });

  it('keeps preset insertion stable when constraints already exist', () => {
    const store = useInvoiceDesignerStore.getState();
    store.addConstraint({ id: 'al', type: 'align-left', nodes: ['field-a', 'field-b'] });
    const beforeNodes = useInvoiceDesignerStore.getState().nodes.length;

    store.insertPreset('header-logo-address', { x: 100, y: 100 });
    const after = useInvoiceDesignerStore.getState();
    expect(after.nodes.length).toBeGreaterThan(beforeNodes);
    expect(after.constraints.every((constraint) => {
      if (constraint.type === 'aspect-ratio') {
        return after.nodes.some((node) => node.id === constraint.nodeId);
      }
      return after.nodes.some((node) => node.id === constraint.nodes[0]) &&
        after.nodes.some((node) => node.id === constraint.nodes[1]);
    })).toBe(true);
  });
});
