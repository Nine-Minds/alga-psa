import { describe, expect, it } from 'vitest';

import type { DesignerNode } from '../state/designerStore';
import { __designCanvasSelectionTestUtils } from './DesignCanvas';

const createNode = (overrides: Partial<DesignerNode>): DesignerNode => ({
  id: overrides.id ?? 'node-' + Math.random().toString(36).slice(2, 7),
  type: overrides.type ?? 'text',
  name: overrides.name ?? 'Node',
  position: overrides.position ?? { x: 0, y: 0 },
  size: overrides.size ?? { width: 100, height: 40 },
  baseSize: overrides.baseSize ?? overrides.size ?? { width: 100, height: 40 },
  canRotate: overrides.canRotate ?? true,
  allowResize: overrides.allowResize ?? true,
  rotation: overrides.rotation ?? 0,
  metadata: overrides.metadata ?? {},
  layoutPresetId: overrides.layoutPresetId,
  layout: overrides.layout,
  parentId: overrides.parentId ?? null,
  childIds: overrides.childIds ?? [],
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
});
