import { DesignerComponentType, Size } from '../state/designerStore';
import { DesignerComponentCategory, getComponentSchema } from '../schema/componentSchema';

type CatalogCategory = DesignerComponentCategory;

export interface ComponentDefinition {
  type: DesignerComponentType;
  label: string;
  description: string;
  category: CatalogCategory;
  defaultSize: Size;
  defaultMetadata?: Record<string, unknown>;
}

const PALETTE_TYPES: ComponentDefinition['type'][] = [
  'section',
  'container',
  'divider',
  'spacer',
  'text',
  'totals',
  'table',
  'dynamic-table',
  'field',
  'label',
  'subtotal',
  'tax',
  'discount',
  'custom-total',
  'signature',
  'action-button',
  'attachment-list',
  'image',
  'logo',
  'qr',
];

export const COMPONENT_CATALOG: ComponentDefinition[] = PALETTE_TYPES.map((type) => {
  const schema = getComponentSchema(type);
  return {
    type,
    label: schema.label,
    description: schema.description,
    category: schema.category,
    defaultSize: schema.defaults.size ?? { width: 160, height: 64 },
    defaultMetadata: schema.defaults.metadata,
  };
});

export const getDefinition = (type: DesignerComponentType) =>
  COMPONENT_CATALOG.find((component) => component.type === type);
