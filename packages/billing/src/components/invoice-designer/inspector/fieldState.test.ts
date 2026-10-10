import { describe, expect, it } from 'vitest';
import { getAllowedChildrenForType } from '../schema/componentSchema';
import type { DesignerInspectorField } from '../schema/inspectorSchema';
import type { DesignerNode } from '../state/designerStore';
import { isFieldSetOnNode } from './fieldState';

const container = (layout: Record<string, unknown>, style: Record<string, unknown> = {}): DesignerNode => ({
  id: 'box',
  type: 'container',
  props: { name: 'box', layout, style },
  position: { x: 0, y: 0 },
  size: { width: 320, height: 120 },
  parentId: null,
  children: [],
  allowedChildren: getAllowedChildrenForType('container'),
});

const gap: DesignerInspectorField = { kind: 'css-length-stepper', id: 'gap', label: 'Gap', path: 'layout.gap' };
const background: DesignerInspectorField = { kind: 'css-color', id: 'backgroundColor', label: 'Background', path: 'style.backgroundColor' };

describe('isFieldSetOnNode', () => {
  it('ignores values a new block of the same type already has', () => {
    // A new Box Container starts with an 8px gap: carrying it is not an authored choice.
    expect(isFieldSetOnNode(container({ display: 'flex', gap: '8px' }), gap)).toBe(false);
    expect(isFieldSetOnNode(container({ display: 'flex', gap: '24px' }), gap)).toBe(true);
  });

  it('treats empty values as unset', () => {
    expect(isFieldSetOnNode(container({}, { backgroundColor: '' }), background)).toBe(false);
    expect(isFieldSetOnNode(container({}, { backgroundColor: '#f9fafb' }), background)).toBe(true);
  });
});
