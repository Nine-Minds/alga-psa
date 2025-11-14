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
    ],
    allowedParents: ['section'],
  },
  text: {
    allowedChildren: [],
    allowedParents: ['column'],
  },
  totals: {
    allowedChildren: [],
    allowedParents: ['column'],
  },
  table: {
    allowedChildren: [],
    allowedParents: ['column'],
  },
  'dynamic-table': {
    allowedChildren: [],
    allowedParents: ['column'],
  },
  field: {
    allowedChildren: [],
    allowedParents: ['column'],
  },
  label: {
    allowedChildren: [],
    allowedParents: ['column'],
  },
  subtotal: {
    allowedChildren: [],
    allowedParents: ['column'],
  },
  tax: {
    allowedChildren: [],
    allowedParents: ['column'],
  },
  discount: {
    allowedChildren: [],
    allowedParents: ['column'],
  },
  'custom-total': {
    allowedChildren: [],
    allowedParents: ['column'],
  },
  image: {
    allowedChildren: [],
    allowedParents: ['column'],
  },
  logo: {
    allowedChildren: [],
    allowedParents: ['column'],
  },
  qr: {
    allowedChildren: [],
    allowedParents: ['column'],
  },
  signature: {
    allowedChildren: [],
    allowedParents: ['column'],
  },
  'action-button': {
    allowedChildren: [],
    allowedParents: ['column'],
  },
  'attachment-list': {
    allowedChildren: [],
    allowedParents: ['column'],
  },
};

export const getAllowedChildrenForType = (type: DesignerComponentType): DesignerComponentType[] =>
  HIERARCHY_RULES[type]?.allowedChildren ?? [];

export const getAllowedParentsForType = (type: DesignerComponentType): DesignerComponentType[] =>
  HIERARCHY_RULES[type]?.allowedParents ?? [];

export const canNestWithinParent = (childType: DesignerComponentType, parentType: DesignerComponentType): boolean =>
  getAllowedParentsForType(childType).includes(parentType);
