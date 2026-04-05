import type { DesignerComponentType, DesignerNode, DesignerNodeStyle } from '../state/designerStore';

export type DesignerWidthMode = 'fixed' | 'fill' | 'hug';
export type DesignerHeightMode = 'fixed' | 'hug';

const SHARED_SIZING_COMPONENT_TYPES = new Set<DesignerComponentType>([
  'table',
  'dynamic-table',
  'totals',
  'signature',
  'attachment-list',
  'action-button',
]);

const normalizeCssValue = (value: unknown): string => (typeof value === 'string' ? value.trim().toLowerCase() : '');

export const supportsSharedSizingModes = (type: DesignerComponentType): boolean =>
  SHARED_SIZING_COMPONENT_TYPES.has(type);

export const inferWidthMode = (style: Partial<DesignerNodeStyle> | undefined): DesignerWidthMode => {
  const width = normalizeCssValue(style?.width);
  if (width === '100%') {
    return 'fill';
  }
  if (width === 'fit-content' || width === 'max-content' || width === 'auto') {
    return 'hug';
  }
  return 'fixed';
};

export const inferHeightMode = (style: Partial<DesignerNodeStyle> | undefined): DesignerHeightMode => {
  const height = normalizeCssValue(style?.height);
  if (height === 'auto' || height === 'fit-content' || height === 'max-content') {
    return 'hug';
  }
  return 'fixed';
};

export const resolveWidthValueForMode = (
  mode: DesignerWidthMode,
  node: DesignerNode
): string => {
  if (mode === 'fill') {
    return '100%';
  }
  if (mode === 'hug') {
    return 'fit-content';
  }
  return `${Math.round(node.size.width)}px`;
};

export const resolveHeightValueForMode = (
  mode: DesignerHeightMode,
  node: DesignerNode
): string => {
  if (mode === 'hug') {
    return 'auto';
  }
  return `${Math.round(node.size.height)}px`;
};
