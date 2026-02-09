import { describe, expect, it } from 'vitest';

import type { DesignerNode } from '../state/designerStore';
import { __designCanvasPreviewTestUtils } from './DesignCanvas';

const createNode = (overrides: Partial<DesignerNode>): DesignerNode => ({
  id: overrides.id ?? 'node-' + Math.random().toString(36).slice(2, 7),
  type: overrides.type ?? 'subtotal',
  name: overrides.name ?? 'Subtotal',
  position: overrides.position ?? { x: 0, y: 0 },
  size: overrides.size ?? { width: 280, height: 56 },
  baseSize: overrides.baseSize ?? overrides.size ?? { width: 280, height: 56 },
  canRotate: overrides.canRotate ?? true,
  rotation: overrides.rotation ?? 0,
  allowResize: overrides.allowResize ?? true,
  metadata: overrides.metadata ?? {},
  layoutPresetId: overrides.layoutPresetId,
  parentId: overrides.parentId ?? null,
  childIds: overrides.childIds ?? [],
  allowedChildren: overrides.allowedChildren ?? [],
  layout: overrides.layout,
});

describe('DesignCanvas totals preview model', () => {
  it('provides sane fallbacks for subtotal rows', () => {
    const node = createNode({
      type: 'subtotal',
      name: 'Subtotal',
      metadata: {},
    });

    const model = __designCanvasPreviewTestUtils.resolveTotalsRowPreviewModel(node);
    expect(model.label).toBe('Subtotal');
    expect(model.bindingKey).toBe('invoice.subtotal');
    expect(model.previewValue).toBe('$1,200.00');
    expect(model.isGrandTotal).toBe(false);
  });

  it('detects grand total emphasis and respects metadata overrides', () => {
    const node = createNode({
      type: 'custom-total',
      name: 'Custom Total',
      metadata: {
        label: 'Grand Total',
        bindingKey: 'invoice.balanceDue',
        previewValue: '$4,096.21',
      },
    });

    const model = __designCanvasPreviewTestUtils.resolveTotalsRowPreviewModel(node);
    expect(model.label).toBe('Grand Total');
    expect(model.bindingKey).toBe('invoice.balanceDue');
    expect(model.previewValue).toBe('$4,096.21');
    expect(model.isGrandTotal).toBe(true);
  });
});
