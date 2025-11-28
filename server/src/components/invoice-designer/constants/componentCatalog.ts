import { DesignerComponentType, Size } from '../state/designerStore';

type CatalogCategory = 'Structure' | 'Content' | 'Media' | 'Dynamic';

export interface ComponentDefinition {
  type: DesignerComponentType;
  label: string;
  description: string;
  category: CatalogCategory;
  defaultSize: Size;
  defaultMetadata?: Record<string, unknown>;
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
    type: 'container',
    label: 'Box Container',
    description: 'Styled container for grouping content (borders, backgrounds).',
    category: 'Structure',
    defaultSize: { width: 320, height: 120 },
  },
  {
    type: 'divider',
    label: 'Divider',
    description: 'Horizontal line separator.',
    category: 'Structure',
    defaultSize: { width: 320, height: 2 },
  },
  {
    type: 'spacer',
    label: 'Spacer',
    description: 'Empty space for layout adjustment.',
    category: 'Structure',
    defaultSize: { width: 320, height: 32 },
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
    defaultMetadata: {
      columns: [
        { id: 'col-desc', header: 'Description', key: 'item.description', type: 'text', width: 220 },
        { id: 'col-qty', header: 'Qty', key: 'item.quantity', type: 'number', width: 60 },
        { id: 'col-rate', header: 'Rate', key: 'item.rate', type: 'currency', width: 100 },
        { id: 'col-total', header: 'Amount', key: 'item.total', type: 'currency', width: 120 },
      ],
    },
  },
  {
    type: 'dynamic-table',
    label: 'Dynamic Table',
    description: 'Advanced data table with column bindings.',
    category: 'Dynamic',
    defaultSize: { width: 520, height: 240 },
  },
  {
    type: 'field',
    label: 'Data Field',
    description: 'Displays a bound value (invoice number, dates, totals).',
    category: 'Content',
    defaultSize: { width: 200, height: 48 },
    defaultMetadata: {
      bindingKey: 'invoice.number',
      format: 'text',
      placeholder: 'Invoice Number',
    },
  },
  {
    type: 'label',
    label: 'Field Label',
    description: 'Static label paired with data fields.',
    category: 'Content',
    defaultSize: { width: 160, height: 40 },
    defaultMetadata: {
      text: 'Label',
    },
  },
  {
    type: 'subtotal',
    label: 'Subtotal Row',
    description: 'Displays pre-tax subtotal.',
    category: 'Content',
    defaultSize: { width: 320, height: 56 },
    defaultMetadata: {
      variant: 'subtotal',
      label: 'Subtotal',
      bindingKey: 'invoice.subtotal',
    },
  },
  {
    type: 'tax',
    label: 'Tax Row',
    description: 'Displays calculated tax amount.',
    category: 'Content',
    defaultSize: { width: 320, height: 56 },
    defaultMetadata: {
      variant: 'tax',
      label: 'Tax',
      bindingKey: 'invoice.tax',
    },
  },
  {
    type: 'discount',
    label: 'Discount Row',
    description: 'Displays discount amount.',
    category: 'Content',
    defaultSize: { width: 320, height: 56 },
    defaultMetadata: {
      variant: 'discount',
      label: 'Discount',
      bindingKey: 'invoice.discount',
    },
  },
  {
    type: 'custom-total',
    label: 'Custom Total Row',
    description: 'Configurable computed row (fees, credits, etc.).',
    category: 'Content',
    defaultSize: { width: 320, height: 56 },
    defaultMetadata: {
      variant: 'custom',
      label: 'Custom Total',
      bindingKey: 'invoice.custom',
    },
  },
  {
    type: 'signature',
    label: 'Signature Block',
    description: 'Signer name and signature line or image.',
    category: 'Content',
    defaultSize: { width: 320, height: 120 },
    defaultMetadata: {
      signerLabel: 'Authorized Signature',
      includeDate: true,
    },
  },
  {
    type: 'action-button',
    label: 'Action Button',
    description: 'Call-to-action button (e.g., Pay Now).',
    category: 'Content',
    defaultSize: { width: 200, height: 48 },
    defaultMetadata: {
      label: 'Pay Now',
      actionType: 'url',
      actionValue: 'https://example.com/pay',
    },
  },
  {
    type: 'attachment-list',
    label: 'Attachment List',
    description: 'Displays supporting documents or links.',
    category: 'Content',
    defaultSize: { width: 320, height: 120 },
    defaultMetadata: {
      title: 'Attachments',
      items: [
        { id: 'att-1', label: 'Contract.pdf', url: 'https://example.com/contract.pdf' },
      ],
    },
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
