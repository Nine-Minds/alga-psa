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
    allowedChildren: ['column'],
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
    allowedParents: ['column', 'container'],
  },
  totals: {
    allowedChildren: [],
    allowedParents: ['column', 'container'],
  },
  table: {
    allowedChildren: [],
    allowedParents: ['column', 'container'],
  },
  'dynamic-table': {
    allowedChildren: [],
    allowedParents: ['column', 'container'],
  },
  field: {
    allowedChildren: [],
    allowedParents: ['column', 'container'],
  },
  label: {
    allowedChildren: [],
    allowedParents: ['column', 'container'],
  },
  subtotal: {
    allowedChildren: [],
    allowedParents: ['column', 'container'],
  },
  tax: {
    allowedChildren: [],
    allowedParents: ['column', 'container'],
  },
  discount: {
    allowedChildren: [],
    allowedParents: ['column', 'container'],
  },
  'custom-total': {
    allowedChildren: [],
    allowedParents: ['column', 'container'],
  },
  image: {
    allowedChildren: [],
    allowedParents: ['column', 'container'],
  },
  logo: {
    allowedChildren: [],
    allowedParents: ['column', 'container'],
  },
  qr: {
    allowedChildren: [],
    allowedParents: ['column', 'container'],
  },
  signature: {
    allowedChildren: [],
    allowedParents: ['column', 'container'],
  },
  'action-button': {
    allowedChildren: [],
    allowedParents: ['column', 'container'],
  },
  'attachment-list': {
    allowedChildren: [],
    allowedParents: ['column', 'container'],
  },
  divider: {
    allowedChildren: [],
    allowedParents: ['column', 'container'],
  },
  spacer: {
    allowedChildren: [],
    allowedParents: ['column', 'container'],
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
    allowedParents: ['column', 'container'],
  },
};

export const getAllowedChildrenForType = (type: DesignerComponentType): DesignerComponentType[] =>
  HIERARCHY_RULES[type]?.allowedChildren ?? [];

export const getAllowedParentsForType = (type: DesignerComponentType): DesignerComponentType[] =>
  HIERARCHY_RULES[type]?.allowedParents ?? [];

export const canNestWithinParent = (childType: DesignerComponentType, parentType: DesignerComponentType): boolean =>
  getAllowedParentsForType(childType).includes(parentType);
