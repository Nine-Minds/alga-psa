import type { DesignerNode } from '../state/designerStore';

// Layout helpers should map designer state to CSS-like semantics.
// Any bespoke geometry/constraint math belongs outside this module (or is eliminated during cutover).

export interface AlignmentGuide {
  type: 'vertical' | 'horizontal';
  position: number;
  description: string;
}

export const resolveFlexPadding = (node: Pick<DesignerNode, 'layout'>): number => {
  const layout = node.layout as unknown as Record<string, unknown> | undefined;
  if (!layout) return 0;

  // Legacy (pre CSS-cutover) shape.
  if (layout.mode === 'flex') {
    const padding = Number(layout.padding);
    return Number.isFinite(padding) ? Math.max(0, padding) : 0;
  }

  // CSS-first shape.
  const paddingValue = layout.padding;
  if (typeof paddingValue === 'number') {
    return Number.isFinite(paddingValue) ? Math.max(0, paddingValue) : 0;
  }
  if (typeof paddingValue === 'string') {
    const trimmed = paddingValue.trim();
    if (trimmed.endsWith('px')) {
      const parsed = Number.parseFloat(trimmed.slice(0, -2));
      return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
    }
  }

  return 0;
};

