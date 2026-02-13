import type {
  DesignerComponentType,
  DesignerContainerLayout,
  DesignerNodeStyle,
  Size,
} from '../state/designerStore';
import { DESIGNER_CANVAS_BOUNDS } from '../constants/layout';

export type DesignerComponentCategory = 'Structure' | 'Content' | 'Media' | 'Dynamic';

export type DesignerComponentDefaults = {
  name?: string;
  size?: Size;
  layout?: Partial<DesignerContainerLayout>;
  style?: Partial<DesignerNodeStyle>;
  metadata?: Record<string, unknown>;
};

export type DesignerComponentHierarchy = {
  allowedChildren: DesignerComponentType[];
  allowedParents: DesignerComponentType[];
};

export interface DesignerComponentSchema {
  type: DesignerComponentType;
  label: string;
  description: string;
  category: DesignerComponentCategory;
  defaults: DesignerComponentDefaults;
  hierarchy: DesignerComponentHierarchy;

  // Future: inspector schema (field panels / widgets) will live here.
  inspector?: unknown;
}

export const DESIGNER_COMPONENT_SCHEMAS: Record<DesignerComponentType, DesignerComponentSchema> = {
  document: {
    type: 'document',
    label: 'Document',
    description: 'Invoice document root.',
    category: 'Structure',
    defaults: {
      name: 'Document',
      size: { width: DESIGNER_CANVAS_BOUNDS.width, height: DESIGNER_CANVAS_BOUNDS.height },
      layout: {
        display: 'flex',
        flexDirection: 'column',
        gap: '0px',
        padding: '0px',
        justifyContent: 'flex-start',
        alignItems: 'stretch',
      },
      metadata: {},
    },
    hierarchy: {
      allowedChildren: ['page'],
      allowedParents: [],
    },
  },
  page: {
    type: 'page',
    label: 'Page',
    description: 'A single invoice page.',
    category: 'Structure',
    defaults: {
      size: { width: DESIGNER_CANVAS_BOUNDS.width, height: DESIGNER_CANVAS_BOUNDS.height },
      layout: {
        display: 'flex',
        flexDirection: 'column',
        gap: '32px',
        padding: '40px',
        justifyContent: 'flex-start',
        alignItems: 'stretch',
      },
      metadata: {},
    },
    hierarchy: {
      allowedChildren: ['section'],
      allowedParents: ['document'],
    },
  },
  section: {
    type: 'section',
    label: 'Section',
    description: 'Logical grouping with shared layout rules.',
    category: 'Structure',
    defaults: {
      size: { width: 520, height: 200 },
      layout: {
        display: 'flex',
        flexDirection: 'row',
        gap: '16px',
        padding: '16px',
        justifyContent: 'flex-start',
        alignItems: 'stretch',
      },
      metadata: {
        sectionBorderStyle: 'light',
      },
    },
    hierarchy: {
      allowedChildren: [
        'column',
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
  },
  column: {
    type: 'column',
    label: 'Column',
    description: 'Legacy column container.',
    category: 'Structure',
    defaults: {
      metadata: {},
    },
    hierarchy: {
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
  },
  text: {
    type: 'text',
    label: 'Text Block',
    description: 'Static or data-bound text content.',
    category: 'Content',
    defaults: {
      size: { width: 320, height: 60 },
      metadata: {
        text: 'Text',
      },
    },
    hierarchy: {
      allowedChildren: [],
      allowedParents: ['column', 'container', 'section'],
    },
  },
  totals: {
    type: 'totals',
    label: 'Totals',
    description: 'Subtotal/Tax/Grand total summary.',
    category: 'Content',
    defaults: {
      size: { width: 360, height: 140 },
      metadata: {},
    },
    hierarchy: {
      allowedChildren: [],
      allowedParents: ['column', 'container', 'section'],
    },
  },
  table: {
    type: 'table',
    label: 'Line Items Table',
    description: 'Repeating rows for invoice line items.',
    category: 'Dynamic',
    defaults: {
      size: { width: 520, height: 220 },
      metadata: {
        columns: [
          { id: 'col-desc', header: 'Description', key: 'item.description', type: 'text', width: 220 },
          { id: 'col-qty', header: 'Qty', key: 'item.quantity', type: 'number', width: 60 },
          { id: 'col-rate', header: 'Rate', key: 'item.unitPrice', type: 'currency', width: 100 },
          { id: 'col-total', header: 'Amount', key: 'item.total', type: 'currency', width: 120 },
        ],
        tableBorderPreset: 'boxed',
        tableOuterBorder: true,
        tableRowDividers: true,
        tableColumnDividers: false,
        tableHeaderFontWeight: 'semibold',
      },
    },
    hierarchy: {
      allowedChildren: [],
      allowedParents: ['column', 'container', 'section'],
    },
  },
  'dynamic-table': {
    type: 'dynamic-table',
    label: 'Dynamic Table',
    description: 'Advanced data table with column bindings.',
    category: 'Dynamic',
    defaults: {
      size: { width: 520, height: 240 },
      metadata: {
        tableBorderPreset: 'boxed',
        tableOuterBorder: true,
        tableRowDividers: true,
        tableColumnDividers: false,
        tableHeaderFontWeight: 'semibold',
      },
    },
    hierarchy: {
      allowedChildren: [],
      allowedParents: ['column', 'container', 'section'],
    },
  },
  field: {
    type: 'field',
    label: 'Data Field',
    description: 'Displays a bound value (invoice number, dates, totals).',
    category: 'Content',
    defaults: {
      size: { width: 200, height: 48 },
      metadata: {
        bindingKey: 'invoice.number',
        format: 'text',
        placeholder: 'Invoice Number',
        fieldBorderStyle: 'underline',
      },
    },
    hierarchy: {
      allowedChildren: [],
      allowedParents: ['column', 'container', 'section'],
    },
  },
  label: {
    type: 'label',
    label: 'Field Label',
    description: 'Static label paired with data fields.',
    category: 'Content',
    defaults: {
      size: { width: 120, height: 28 },
      metadata: {
        text: 'Label',
        fontWeight: 'semibold',
      },
    },
    hierarchy: {
      allowedChildren: [],
      allowedParents: ['column', 'container', 'section'],
    },
  },
  subtotal: {
    type: 'subtotal',
    label: 'Subtotal Row',
    description: 'Displays pre-tax subtotal.',
    category: 'Content',
    defaults: {
      size: { width: 320, height: 56 },
      metadata: {
        variant: 'subtotal',
        label: 'Subtotal',
        bindingKey: 'invoice.subtotal',
      },
    },
    hierarchy: {
      allowedChildren: [],
      allowedParents: ['column', 'container', 'section'],
    },
  },
  tax: {
    type: 'tax',
    label: 'Tax Row',
    description: 'Displays calculated tax amount.',
    category: 'Content',
    defaults: {
      size: { width: 320, height: 56 },
      metadata: {
        variant: 'tax',
        label: 'Tax',
        bindingKey: 'invoice.tax',
      },
    },
    hierarchy: {
      allowedChildren: [],
      allowedParents: ['column', 'container', 'section'],
    },
  },
  discount: {
    type: 'discount',
    label: 'Discount Row',
    description: 'Displays discount amount.',
    category: 'Content',
    defaults: {
      size: { width: 320, height: 56 },
      metadata: {
        variant: 'discount',
        label: 'Discount',
        bindingKey: 'invoice.discount',
      },
    },
    hierarchy: {
      allowedChildren: [],
      allowedParents: ['column', 'container', 'section'],
    },
  },
  'custom-total': {
    type: 'custom-total',
    label: 'Custom Total Row',
    description: 'Configurable computed row (fees, credits, etc.).',
    category: 'Content',
    defaults: {
      size: { width: 320, height: 56 },
      metadata: {
        variant: 'custom',
        label: 'Total',
        bindingKey: 'invoice.total',
      },
    },
    hierarchy: {
      allowedChildren: [],
      allowedParents: ['column', 'container', 'section'],
    },
  },
  image: {
    type: 'image',
    label: 'Image',
    description: 'Inline image element.',
    category: 'Media',
    defaults: {
      size: { width: 160, height: 120 },
      style: {
        objectFit: 'contain',
      },
      metadata: {},
    },
    hierarchy: {
      allowedChildren: [],
      allowedParents: ['column', 'container', 'section'],
    },
  },
  logo: {
    type: 'logo',
    label: 'Logo',
    description: 'Tenant branding asset.',
    category: 'Media',
    defaults: {
      size: { width: 200, height: 120 },
      style: {
        objectFit: 'contain',
      },
      metadata: {},
    },
    hierarchy: {
      allowedChildren: [],
      allowedParents: ['column', 'container', 'section'],
    },
  },
  qr: {
    type: 'qr',
    label: 'QR Code',
    description: 'Auto-generated QR for payment links.',
    category: 'Media',
    defaults: {
      size: { width: 140, height: 140 },
      style: {
        objectFit: 'contain',
        aspectRatio: '1 / 1',
      },
      metadata: {},
    },
    hierarchy: {
      allowedChildren: [],
      allowedParents: ['column', 'container', 'section'],
    },
  },
  signature: {
    type: 'signature',
    label: 'Signature Block',
    description: 'Signer name and signature line or image.',
    category: 'Content',
    defaults: {
      size: { width: 320, height: 120 },
      metadata: {
        signerLabel: 'Authorized Signature',
        includeDate: true,
      },
    },
    hierarchy: {
      allowedChildren: [],
      allowedParents: ['column', 'container', 'section'],
    },
  },
  'action-button': {
    type: 'action-button',
    label: 'Action Button',
    description: 'Call-to-action button (e.g., Pay Now).',
    category: 'Content',
    defaults: {
      size: { width: 200, height: 48 },
      metadata: {
        label: 'Pay Now',
        actionType: 'url',
        actionValue: 'https://example.com/pay',
      },
    },
    hierarchy: {
      allowedChildren: [],
      allowedParents: ['column', 'container', 'section'],
    },
  },
  'attachment-list': {
    type: 'attachment-list',
    label: 'Attachment List',
    description: 'Displays supporting documents or links.',
    category: 'Content',
    defaults: {
      size: { width: 320, height: 120 },
      metadata: {
        title: 'Attachments',
        items: [{ id: 'att-1', label: 'Contract.pdf', url: 'https://example.com/contract.pdf' }],
      },
    },
    hierarchy: {
      allowedChildren: [],
      allowedParents: ['column', 'container', 'section'],
    },
  },
  divider: {
    type: 'divider',
    label: 'Divider',
    description: 'Horizontal line separator.',
    category: 'Structure',
    defaults: {
      size: { width: 320, height: 2 },
      metadata: {},
    },
    hierarchy: {
      allowedChildren: [],
      allowedParents: ['column', 'container', 'section'],
    },
  },
  spacer: {
    type: 'spacer',
    label: 'Spacer',
    description: 'Empty space for layout adjustment.',
    category: 'Structure',
    defaults: {
      size: { width: 320, height: 32 },
      metadata: {},
    },
    hierarchy: {
      allowedChildren: [],
      allowedParents: ['column', 'container', 'section'],
    },
  },
  container: {
    type: 'container',
    label: 'Box Container',
    description: 'Styled container for grouping content (borders, backgrounds).',
    category: 'Structure',
    defaults: {
      size: { width: 320, height: 120 },
      layout: {
        display: 'flex',
        flexDirection: 'column',
        gap: '16px',
        padding: '16px',
        justifyContent: 'flex-start',
        alignItems: 'stretch',
      },
      metadata: {},
    },
    hierarchy: {
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
  },
};

export const getComponentSchema = (type: DesignerComponentType): DesignerComponentSchema =>
  DESIGNER_COMPONENT_SCHEMAS[type];
