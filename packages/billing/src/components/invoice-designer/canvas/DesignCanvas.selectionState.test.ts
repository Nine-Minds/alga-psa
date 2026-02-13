import { describe, expect, it } from 'vitest';

import type { DesignerNode } from '../state/designerStore';
import { __designCanvasSelectionTestUtils } from './DesignCanvas';

const createNode = (overrides: Partial<DesignerNode>): DesignerNode => ({
  id: overrides.id ?? 'node-' + Math.random().toString(36).slice(2, 7),
  type: overrides.type ?? 'text',
  props: overrides.props ?? {
    name: 'Node',
    metadata: {},
    style: { width: '100px', height: '40px' },
  },
  position: overrides.position ?? { x: 0, y: 0 },
  size: overrides.size ?? { width: 100, height: 40 },
  baseSize: overrides.baseSize ?? overrides.size ?? { width: 100, height: 40 },
  canRotate: overrides.canRotate ?? true,
  allowResize: overrides.allowResize ?? true,
  rotation: overrides.rotation ?? 0,
  layoutPresetId: overrides.layoutPresetId,
  parentId: overrides.parentId ?? null,
  children: overrides.children ?? [],
  allowedChildren: overrides.allowedChildren ?? [],
});

describe('DesignCanvas renderable selection state', () => {
  it('returns false when selected id is null', () => {
    const nodes = [createNode({ id: 'text-1', type: 'text' })];
    expect(__designCanvasSelectionTestUtils.hasRenderableActiveSelection(nodes, null)).toBe(false);
  });

  it('returns false when selected id is a non-rendered root (page/document)', () => {
    const nodes = [
      createNode({ id: 'doc', type: 'document', parentId: null }),
      createNode({ id: 'page', type: 'page', parentId: 'doc' }),
      createNode({ id: 'text-1', type: 'text', parentId: 'page' }),
    ];
    expect(__designCanvasSelectionTestUtils.hasRenderableActiveSelection(nodes, 'doc')).toBe(false);
    expect(__designCanvasSelectionTestUtils.hasRenderableActiveSelection(nodes, 'page')).toBe(false);
  });

  it('returns true when selected id is a rendered canvas node', () => {
    const nodes = [
      createNode({ id: 'doc', type: 'document', parentId: null }),
      createNode({ id: 'page', type: 'page', parentId: 'doc' }),
      createNode({ id: 'section-1', type: 'section', parentId: 'page' }),
    ];
    expect(__designCanvasSelectionTestUtils.hasRenderableActiveSelection(nodes, 'section-1')).toBe(true);
  });

  it('treats tiny pointer movement as a click for deselection toggles', () => {
    expect(
      __designCanvasSelectionTestUtils.hasMovedBeyondThreshold(
        { x: 100, y: 100 },
        { x: 102, y: 101 }
      )
    ).toBe(false);
  });

  it('treats larger pointer movement as drag to avoid accidental deselection', () => {
    expect(
      __designCanvasSelectionTestUtils.hasMovedBeyondThreshold(
        { x: 100, y: 100 },
        { x: 108, y: 104 }
      )
    ).toBe(true);
  });

  it('does not toggle selection off when pointer down started on an unselected node', () => {
    expect(__designCanvasSelectionTestUtils.shouldToggleSelectionOff(false, false)).toBe(false);
  });

  it('toggles selection off for click on already selected node', () => {
    expect(__designCanvasSelectionTestUtils.shouldToggleSelectionOff(true, false)).toBe(true);
  });

  it('does not toggle selection off after drag movement even if node was selected', () => {
    expect(__designCanvasSelectionTestUtils.shouldToggleSelectionOff(true, true)).toBe(false);
  });

  it('keeps selected node context (ancestors and descendants) out of deemphasis', () => {
    const nodes = [
      createNode({ id: 'doc', type: 'document', parentId: null }),
      createNode({ id: 'page', type: 'page', parentId: 'doc' }),
      createNode({ id: 'section-a', type: 'section', parentId: 'page' }),
      createNode({ id: 'field-a', type: 'field', parentId: 'section-a' }),
      createNode({ id: 'section-b', type: 'section', parentId: 'page' }),
      createNode({ id: 'field-b', type: 'field', parentId: 'section-b' }),
    ];
    const selectionContext = __designCanvasSelectionTestUtils.collectSelectionContextNodeIds(nodes, 'field-a');

    expect(selectionContext.has('field-a')).toBe(true);
    expect(selectionContext.has('section-a')).toBe(true);
    expect(selectionContext.has('page')).toBe(true);
    expect(selectionContext.has('doc')).toBe(true);
    expect(selectionContext.has('section-b')).toBe(false);
    expect(selectionContext.has('field-b')).toBe(false);

    expect(__designCanvasSelectionTestUtils.shouldDeemphasizeNode(true, true, false)).toBe(false);
    expect(__designCanvasSelectionTestUtils.shouldDeemphasizeNode(true, false, false)).toBe(true);
  });
});
