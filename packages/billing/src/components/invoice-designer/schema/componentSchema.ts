import type {
  DesignerComponentType,
  DesignerContainerLayout,
  DesignerNodeStyle,
  Size,
} from '../state/designerStore';
import { DESIGNER_CANVAS_BOUNDS } from '../constants/layout';
import type { DesignerInspectorSchema } from './inspectorSchema';

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

  inspector?: DesignerInspectorSchema;
}

const mergeInspectorSchemas = (...schemas: Array<DesignerInspectorSchema | undefined>): DesignerInspectorSchema => ({
  panels: schemas.flatMap((schema) => schema?.panels ?? []),
});

const COMMON_INSPECTOR: DesignerInspectorSchema = {
  panels: [
    {
      id: 'layout',
      title: 'Layout',
      visibleWhen: { kind: 'nodeIsContainer' },
      fields: [
        {
          kind: 'enum',
          id: 'display',
          label: 'Mode',
          path: 'layout.display',
          options: [
            { value: 'flex', label: 'Stack (Flex)' },
            { value: 'grid', label: 'Grid' },
          ],
        },
        {
          kind: 'css-length',
          id: 'gap',
          label: 'Gap',
          path: 'layout.gap',
          placeholder: '0px',
        },
        {
          kind: 'css-length',
          id: 'padding',
          label: 'Padding',
          path: 'layout.padding',
          placeholder: '0px',
        },
        {
          kind: 'enum',
          id: 'flexDirection',
          label: 'Direction',
          path: 'layout.flexDirection',
          visibleWhen: { kind: 'pathEquals', path: 'layout.display', value: 'flex' },
          options: [
            { value: 'column', label: 'Vertical' },
            { value: 'row', label: 'Horizontal' },
          ],
        },
        {
          kind: 'enum',
          id: 'alignItems',
          label: 'Align Items',
          path: 'layout.alignItems',
          visibleWhen: { kind: 'pathEquals', path: 'layout.display', value: 'flex' },
          options: [
            { value: 'stretch', label: 'Stretch' },
            { value: 'flex-start', label: 'Start' },
            { value: 'center', label: 'Center' },
            { value: 'flex-end', label: 'End' },
          ],
        },
        {
          kind: 'enum',
          id: 'justifyContent',
          label: 'Justify Content',
          path: 'layout.justifyContent',
          visibleWhen: { kind: 'pathEquals', path: 'layout.display', value: 'flex' },
          options: [
            { value: 'flex-start', label: 'Start' },
            { value: 'center', label: 'Center' },
            { value: 'flex-end', label: 'End' },
            { value: 'space-between', label: 'Space Between' },
            { value: 'space-around', label: 'Space Around' },
            { value: 'space-evenly', label: 'Space Evenly' },
          ],
        },
        {
          kind: 'enum',
          id: 'gridAutoFlow',
          label: 'Auto Flow',
          path: 'layout.gridAutoFlow',
          visibleWhen: { kind: 'pathEquals', path: 'layout.display', value: 'grid' },
          options: [
            { value: 'row', label: 'row' },
            { value: 'column', label: 'column' },
            { value: 'dense', label: 'dense' },
            { value: 'row dense', label: 'row dense' },
            { value: 'column dense', label: 'column dense' },
          ],
        },
        {
          kind: 'string',
          id: 'gridTemplateColumns',
          label: 'Template Columns',
          path: 'layout.gridTemplateColumns',
          visibleWhen: { kind: 'pathEquals', path: 'layout.display', value: 'grid' },
          placeholder: 'repeat(2, minmax(0, 1fr))',
        },
        {
          kind: 'string',
          id: 'gridTemplateRows',
          label: 'Template Rows',
          path: 'layout.gridTemplateRows',
          visibleWhen: { kind: 'pathEquals', path: 'layout.display', value: 'grid' },
          placeholder: 'auto',
        },
      ],
    },
    {
      id: 'sizing-css',
      title: 'Sizing (CSS)',
      fields: [
        {
          kind: 'css-length',
          id: 'width',
          label: 'width',
          path: 'style.width',
          placeholder: 'auto | 320px | 50% | 10rem',
        },
        {
          kind: 'css-length',
          id: 'height',
          label: 'height',
          path: 'style.height',
          placeholder: 'auto | 180px | 12rem',
        },
        {
          kind: 'css-length',
          id: 'minWidth',
          label: 'min-width',
          path: 'style.minWidth',
          placeholder: '0 | 200px',
        },
        {
          kind: 'css-length',
          id: 'minHeight',
          label: 'min-height',
          path: 'style.minHeight',
          placeholder: '0 | 120px',
        },
        {
          kind: 'css-length',
          id: 'maxWidth',
          label: 'max-width',
          path: 'style.maxWidth',
          placeholder: 'none | 600px',
        },
        {
          kind: 'css-length',
          id: 'maxHeight',
          label: 'max-height',
          path: 'style.maxHeight',
          placeholder: 'none | 400px',
        },
      ],
    },
    {
      id: 'appearance',
      title: 'Appearance',
      fields: [
        {
          kind: 'css-color',
          id: 'backgroundColor',
          label: 'Background',
          path: 'style.backgroundColor',
          placeholder: '#f9fafb',
        },
        {
          kind: 'css-color',
          id: 'color',
          label: 'Text color',
          path: 'style.color',
          placeholder: '#111827',
        },
        {
          kind: 'string',
          id: 'border',
          label: 'Border',
          path: 'style.border',
          placeholder: '1px solid #e5e7eb',
        },
        {
          kind: 'css-length',
          id: 'borderRadius',
          label: 'Radius',
          path: 'style.borderRadius',
          placeholder: '8px',
        },
        {
          kind: 'css-length',
          id: 'margin',
          label: 'Margin',
          path: 'style.margin',
          placeholder: '0 | 0 0 12px 0',
        },
      ],
    },
    {
      id: 'flex-item',
      title: 'Flex Item',
      visibleWhen: { kind: 'parentPathEquals', path: 'layout.display', value: 'flex' },
      fields: [
        {
          kind: 'number',
          id: 'flexGrow',
          label: 'flex-grow',
          path: 'style.flexGrow',
          placeholder: '0',
        },
        {
          kind: 'number',
          id: 'flexShrink',
          label: 'flex-shrink',
          path: 'style.flexShrink',
          placeholder: '1',
        },
        {
          kind: 'css-length',
          id: 'flexBasis',
          label: 'flex-basis',
          path: 'style.flexBasis',
          placeholder: 'auto | 240px | 50%',
        },
      ],
    },
  ],
};

const SECTION_INSPECTOR: DesignerInspectorSchema = {
  panels: [
    {
      id: 'section-border',
      title: 'Section Border',
      fields: [
        {
          kind: 'enum',
          id: 'sectionBorderStyle',
          domId: 'designer-section-border-style',
          label: 'Border style',
          path: 'metadata.sectionBorderStyle',
          options: [
            { value: 'light', label: 'Light' },
            { value: 'strong', label: 'Strong' },
            { value: 'none', label: 'None' },
          ],
        },
      ],
    },
  ],
};

const FIELD_INSPECTOR: DesignerInspectorSchema = {
  panels: [
    {
      id: 'field-binding',
      title: 'Field Binding',
      fields: [
        {
          kind: 'string',
          id: 'label',
          domId: 'designer-field-label',
          label: 'Label',
          path: 'metadata.label',
          placeholder: 'Invoice #',
        },
        {
          kind: 'string',
          id: 'bindingKey',
          domId: 'designer-field-binding',
          label: 'Binding key',
          path: 'metadata.bindingKey',
        },
        {
          kind: 'enum',
          id: 'format',
          label: 'Format',
          path: 'metadata.format',
          options: [
            { value: 'text', label: 'Text' },
            { value: 'number', label: 'Number' },
            { value: 'currency', label: 'Currency' },
            { value: 'date', label: 'Date' },
          ],
        },
        {
          kind: 'string',
          id: 'emptyValue',
          domId: 'designer-field-empty-value',
          label: 'Empty value',
          path: 'metadata.emptyValue',
          placeholder: '-',
        },
        {
          kind: 'string',
          id: 'placeholder',
          domId: 'designer-field-placeholder',
          label: 'Designer placeholder',
          path: 'metadata.placeholder',
        },
        {
          kind: 'enum',
          id: 'fieldBorderStyle',
          domId: 'designer-field-border-style',
          label: 'Border style',
          path: 'metadata.fieldBorderStyle',
          options: [
            { value: 'underline', label: 'Underline' },
            { value: 'box', label: 'Box' },
            { value: 'none', label: 'None' },
          ],
        },
      ],
    },
  ],
};

const TEXT_INSPECTOR: DesignerInspectorSchema = {
  panels: [
    {
      id: 'text-content',
      title: 'Text Content',
      fields: [
        {
          kind: 'textarea',
          id: 'text',
          domId: 'designer-text-content',
          label: 'Text',
          path: 'metadata.text',
          placeholder: 'Enter text or {{binding.path}}',
        },
      ],
    },
  ],
};

const LABEL_INSPECTOR: DesignerInspectorSchema = {
  panels: [
    {
      id: 'label-style',
      title: 'Label Text',
      fields: [
        {
          kind: 'string',
          id: 'text',
          domId: 'designer-label-text',
          label: 'Text',
          path: 'metadata.text',
          placeholder: 'Label',
        },
        {
          kind: 'enum',
          id: 'fontWeight',
          domId: 'designer-label-weight',
          label: 'Weight',
          path: 'metadata.fontWeight',
          options: [
            { value: 'semibold', label: 'Semibold' },
            { value: 'bold', label: 'Bold' },
            { value: 'medium', label: 'Medium' },
            { value: 'normal', label: 'Normal' },
          ],
        },
      ],
    },
  ],
};

const TOTALS_ROW_INSPECTOR: DesignerInspectorSchema = {
  panels: [
    {
      id: 'totals-row',
      title: 'Totals Row',
      fields: [
        {
          kind: 'string',
          id: 'label',
          domId: 'designer-total-label',
          label: 'Label',
          path: 'metadata.label',
        },
        {
          kind: 'string',
          id: 'bindingKey',
          domId: 'designer-total-binding',
          label: 'Binding key',
          path: 'metadata.bindingKey',
        },
      ],
    },
  ],
};

const CUSTOM_TOTAL_INSPECTOR: DesignerInspectorSchema = {
  panels: [
    {
      id: 'totals-row',
      title: 'Totals Row',
      fields: [
        {
          kind: 'string',
          id: 'label',
          domId: 'designer-total-label',
          label: 'Label',
          path: 'metadata.label',
        },
        {
          kind: 'string',
          id: 'bindingKey',
          domId: 'designer-total-binding',
          label: 'Binding key',
          path: 'metadata.bindingKey',
        },
        {
          kind: 'textarea',
          id: 'notes',
          label: 'Computation notes',
          path: 'metadata.notes',
        },
      ],
    },
  ],
};

const ACTION_BUTTON_INSPECTOR: DesignerInspectorSchema = {
  panels: [
    {
      id: 'action-button',
      title: 'Button',
      fields: [
        {
          kind: 'string',
          id: 'label',
          domId: 'designer-button-label',
          label: 'Label',
          path: 'metadata.label',
          placeholder: 'Button',
        },
        {
          kind: 'enum',
          id: 'actionType',
          label: 'Action type',
          path: 'metadata.actionType',
          options: [
            { value: 'url', label: 'URL' },
            { value: 'mailto', label: 'Email' },
          ],
        },
        {
          kind: 'string',
          id: 'actionValue',
          domId: 'designer-button-action',
          label: 'Action value',
          path: 'metadata.actionValue',
        },
      ],
    },
  ],
};

const SIGNATURE_INSPECTOR: DesignerInspectorSchema = {
  panels: [
    {
      id: 'signature',
      title: 'Signature Block',
      fields: [
        {
          kind: 'string',
          id: 'signerLabel',
          domId: 'designer-signature-label',
          label: 'Signer label',
          path: 'metadata.signerLabel',
          placeholder: 'Authorized Signature',
        },
        {
          kind: 'boolean',
          id: 'includeDate',
          label: 'Include signing date',
          path: 'metadata.includeDate',
        },
      ],
    },
  ],
};

const TABLE_INSPECTOR: DesignerInspectorSchema = {
  panels: [
    {
      id: 'table',
      title: 'Table',
      fields: [
        {
          kind: 'css-length',
          id: 'tablePadding',
          label: 'Table padding',
          path: 'style.padding',
          placeholder: '0px | 8px | 0 8px',
        },
        {
          kind: 'widget',
          id: 'tableEditor',
          widget: 'table-editor',
        },
      ],
    },
  ],
};

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
    inspector: COMMON_INSPECTOR,
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
    inspector: COMMON_INSPECTOR,
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
    inspector: mergeInspectorSchemas(COMMON_INSPECTOR, SECTION_INSPECTOR),
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
    inspector: COMMON_INSPECTOR,
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
    inspector: mergeInspectorSchemas(COMMON_INSPECTOR, TEXT_INSPECTOR),
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
    inspector: COMMON_INSPECTOR,
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
    inspector: mergeInspectorSchemas(COMMON_INSPECTOR, TABLE_INSPECTOR),
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
    inspector: mergeInspectorSchemas(COMMON_INSPECTOR, TABLE_INSPECTOR),
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
    inspector: mergeInspectorSchemas(COMMON_INSPECTOR, FIELD_INSPECTOR),
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
    inspector: mergeInspectorSchemas(COMMON_INSPECTOR, LABEL_INSPECTOR),
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
    inspector: mergeInspectorSchemas(COMMON_INSPECTOR, TOTALS_ROW_INSPECTOR),
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
    inspector: mergeInspectorSchemas(COMMON_INSPECTOR, TOTALS_ROW_INSPECTOR),
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
    inspector: mergeInspectorSchemas(COMMON_INSPECTOR, TOTALS_ROW_INSPECTOR),
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
    inspector: mergeInspectorSchemas(COMMON_INSPECTOR, CUSTOM_TOTAL_INSPECTOR),
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
    inspector: COMMON_INSPECTOR,
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
    inspector: COMMON_INSPECTOR,
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
    inspector: COMMON_INSPECTOR,
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
    inspector: mergeInspectorSchemas(COMMON_INSPECTOR, SIGNATURE_INSPECTOR),
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
    inspector: mergeInspectorSchemas(COMMON_INSPECTOR, ACTION_BUTTON_INSPECTOR),
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
    inspector: COMMON_INSPECTOR,
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
    inspector: COMMON_INSPECTOR,
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
    inspector: COMMON_INSPECTOR,
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
    inspector: COMMON_INSPECTOR,
  },
};

export const getComponentSchema = (type: DesignerComponentType): DesignerComponentSchema =>
  DESIGNER_COMPONENT_SCHEMAS[type];

export const getAllowedChildrenForType = (type: DesignerComponentType): DesignerComponentType[] =>
  getComponentSchema(type).hierarchy.allowedChildren;

export const getAllowedParentsForType = (type: DesignerComponentType): DesignerComponentType[] =>
  getComponentSchema(type).hierarchy.allowedParents;

export const canNestWithinParent = (childType: DesignerComponentType, parentType: DesignerComponentType): boolean =>
  getAllowedParentsForType(childType).includes(parentType);
