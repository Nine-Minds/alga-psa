import { DesignerComponentType, Size } from '../state/designerStore';

type CatalogCategory = 'Structure' | 'Content' | 'Media' | 'Dynamic';

export interface ComponentDefinition {
  type: DesignerComponentType;
  label: string;
  description: string;
  category: CatalogCategory;
  defaultSize: Size;
}

export const COMPONENT_CATALOG: ComponentDefinition[] = [
  {
    type: 'section',
    label: 'Section',
    description: 'Logical grouping with shared layout rules.',
    category: 'Structure',
    defaultSize: { width: 520, height: 200 },
  },
  {
    type: 'column',
    label: 'Column',
    description: 'Sub-layout for arranging child elements.',
    category: 'Structure',
    defaultSize: { width: 240, height: 200 },
  },
  {
    type: 'text',
    label: 'Text Block',
    description: 'Static or data-bound text content.',
    category: 'Content',
    defaultSize: { width: 320, height: 60 },
  },
  {
    type: 'totals',
    label: 'Totals',
    description: 'Subtotal/Tax/Grand total summary.',
    category: 'Content',
    defaultSize: { width: 360, height: 140 },
  },
  {
    type: 'table',
    label: 'Line Items Table',
    description: 'Repeating rows for invoice line items.',
    category: 'Dynamic',
    defaultSize: { width: 520, height: 220 },
  },
  {
    type: 'dynamic-table',
    label: 'Dynamic Table',
    description: 'Advanced data table with column bindings.',
    category: 'Dynamic',
    defaultSize: { width: 520, height: 240 },
  },
  {
    type: 'image',
    label: 'Image',
    description: 'Inline image element.',
    category: 'Media',
    defaultSize: { width: 160, height: 120 },
  },
  {
    type: 'logo',
    label: 'Logo',
    description: 'Tenant branding asset.',
    category: 'Media',
    defaultSize: { width: 200, height: 120 },
  },
  {
    type: 'qr',
    label: 'QR Code',
    description: 'Auto-generated QR for payment links.',
    category: 'Media',
    defaultSize: { width: 140, height: 140 },
  },
];

export const getDefinition = (type: DesignerComponentType) =>
  COMPONENT_CATALOG.find((component) => component.type === type);
