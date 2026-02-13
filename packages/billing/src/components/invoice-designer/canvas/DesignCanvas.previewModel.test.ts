import { describe, expect, it } from 'vitest';

import type { DesignerNode } from '../state/designerStore';
import { __designCanvasPreviewTestUtils } from './DesignCanvas';

const createNode = (overrides: Partial<DesignerNode>): DesignerNode => ({
  id: overrides.id ?? 'node-' + Math.random().toString(36).slice(2, 7),
  type: overrides.type ?? 'subtotal',
  name: overrides.name ?? 'Subtotal',
  props: overrides.props ?? {
    name: overrides.name ?? 'Subtotal',
    metadata: overrides.metadata ?? {},
    layout: overrides.layout,
    style: overrides.style ?? { width: '280px', height: '56px' },
  },
  position: overrides.position ?? { x: 0, y: 0 },
  size: overrides.size ?? { width: 280, height: 56 },
  baseSize: overrides.baseSize ?? overrides.size ?? { width: 280, height: 56 },
  canRotate: overrides.canRotate ?? true,
  rotation: overrides.rotation ?? 0,
  allowResize: overrides.allowResize ?? true,
  metadata: overrides.metadata ?? {},
  layoutPresetId: overrides.layoutPresetId,
  parentId: overrides.parentId ?? null,
  children: overrides.children ?? overrides.childIds ?? [],
  childIds: overrides.childIds ?? [],
  allowedChildren: overrides.allowedChildren ?? [],
  layout: overrides.layout,
  style: overrides.style,
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

describe('DesignCanvas border style resolution', () => {
  it('resolves section and field border defaults safely', () => {
    expect(__designCanvasPreviewTestUtils.resolveSectionBorderStyle({})).toBe('light');
    expect(__designCanvasPreviewTestUtils.resolveSectionBorderStyle({ sectionBorderStyle: 'none' })).toBe('none');
    expect(__designCanvasPreviewTestUtils.resolveSectionBorderStyle({ sectionBorderStyle: 'strong' })).toBe('strong');

    expect(__designCanvasPreviewTestUtils.resolveFieldBorderStyle({})).toBe('underline');
    expect(__designCanvasPreviewTestUtils.resolveFieldBorderStyle({ fieldBorderStyle: 'none' })).toBe('none');
    expect(__designCanvasPreviewTestUtils.resolveFieldBorderStyle({ fieldBorderStyle: 'underline' })).toBe('underline');
  });

  it('normalizes table border config flags with professional defaults', () => {
    expect(__designCanvasPreviewTestUtils.resolveTableBorderPreset({})).toBe('custom');
    expect(__designCanvasPreviewTestUtils.resolveTableBorderPreset({ tableBorderPreset: 'list' })).toBe('list');

    expect(__designCanvasPreviewTestUtils.resolveTableBorderConfig({})).toEqual({
      outer: true,
      rowDividers: true,
      columnDividers: false,
    });

    expect(
      __designCanvasPreviewTestUtils.resolveTableBorderConfig({
        tableOuterBorder: false,
        tableRowDividers: false,
        tableColumnDividers: true,
      })
    ).toEqual({
      outer: false,
      rowDividers: false,
      columnDividers: true,
    });

    expect(
      __designCanvasPreviewTestUtils.resolveTableBorderConfig({
        tableBorderPreset: 'list',
        tableOuterBorder: true,
        tableRowDividers: false,
        tableColumnDividers: true,
      })
    ).toEqual({
      outer: false,
      rowDividers: true,
      columnDividers: false,
    });
  });

  it('normalizes supported font-weight variants with a fallback', () => {
    expect(__designCanvasPreviewTestUtils.resolveFontWeightStyle('bold', 'normal')).toBe('bold');
    expect(__designCanvasPreviewTestUtils.resolveFontWeightStyle('semibold', 'normal')).toBe('semibold');
    expect(__designCanvasPreviewTestUtils.resolveFontWeightStyle('unexpected', 'medium')).toBe('medium');
  });
});
