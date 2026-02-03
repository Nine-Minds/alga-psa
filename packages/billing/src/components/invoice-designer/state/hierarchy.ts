import type { DesignerComponentType } from './designerStore';

type HierarchyConfig = {
  allowedChildren: DesignerComponentType[];
  allowedParents: DesignerComponentType[];
};

const HIERARCHY_RULES: Record<DesignerComponentType, HierarchyConfig> = {
  document: {
    allowedChildren: ['page'],
    allowedParents: [],
  },
  page: {
    allowedChildren: ['section'],
    allowedParents: ['document'],
  },
  section: {
    allowedChildren: [
      'column', // Legacy
      'container',
      'text',
      'totals',
      'table',
      'dynamic-table',
      'image',
      'logo',
      'qr',
      'field',
      'label',
      'subtotal',
      'tax',
      'discount',
      'custom-total',
      'signature',
      'action-button',
      'attachment-list',
      'divider',
      'spacer',
    ],
    allowedParents: ['page'],
  },
  column: {
    allowedChildren: [
      'text',
      'totals',
      'table',
      'dynamic-table',
      'image',
      'logo',
      'qr',
      'field',
      'label',
      'subtotal',
      'tax',
      'discount',
      'custom-total',
      'signature',
      'action-button',
      'attachment-list',
      'divider',
      'spacer',
      'container',
    ],
    allowedParents: ['section'],
  },
  text: {
    allowedChildren: [],
    allowedParents: ['column', 'container', 'section'],
  },
  totals: {
    allowedChildren: [],
    allowedParents: ['column', 'container', 'section'],
  },
  table: {
    allowedChildren: [],
    allowedParents: ['column', 'container', 'section'],
  },
  'dynamic-table': {
    allowedChildren: [],
    allowedParents: ['column', 'container', 'section'],
  },
  field: {
    allowedChildren: [],
    allowedParents: ['column', 'container', 'section'],
  },
  label: {
    allowedChildren: [],
    allowedParents: ['column', 'container', 'section'],
  },
  subtotal: {
    allowedChildren: [],
    allowedParents: ['column', 'container', 'section'],
  },
  tax: {
    allowedChildren: [],
    allowedParents: ['column', 'container', 'section'],
  },
  discount: {
    allowedChildren: [],
    allowedParents: ['column', 'container', 'section'],
  },
  'custom-total': {
    allowedChildren: [],
    allowedParents: ['column', 'container', 'section'],
  },
  image: {
    allowedChildren: [],
    allowedParents: ['column', 'container', 'section'],
  },
  logo: {
    allowedChildren: [],
    allowedParents: ['column', 'container', 'section'],
  },
  qr: {
    allowedChildren: [],
    allowedParents: ['column', 'container', 'section'],
  },
  signature: {
    allowedChildren: [],
    allowedParents: ['column', 'container', 'section'],
  },
  'action-button': {
    allowedChildren: [],
    allowedParents: ['column', 'container', 'section'],
  },
  'attachment-list': {
    allowedChildren: [],
    allowedParents: ['column', 'container', 'section'],
  },
  divider: {
    allowedChildren: [],
    allowedParents: ['column', 'container', 'section'],
  },
  spacer: {
    allowedChildren: [],
    allowedParents: ['column', 'container', 'section'],
  },
  container: {
    allowedChildren: [
      'text',
      'totals',
      'table',
      'dynamic-table',
      'image',
      'logo',
      'qr',
      'field',
      'label',
      'subtotal',
      'tax',
      'discount',
      'custom-total',
      'signature',
      'action-button',
      'attachment-list',
      'divider',
      'spacer',
      'container',
    ],
    allowedParents: ['column', 'container', 'section'],
  },
};

export const getAllowedChildrenForType = (type: DesignerComponentType): DesignerComponentType[] =>
  HIERARCHY_RULES[type]?.allowedChildren ?? [];

export const getAllowedParentsForType = (type: DesignerComponentType): DesignerComponentType[] =>
  HIERARCHY_RULES[type]?.allowedParents ?? [];

export const canNestWithinParent = (childType: DesignerComponentType, parentType: DesignerComponentType): boolean =>
  getAllowedParentsForType(childType).includes(parentType);
