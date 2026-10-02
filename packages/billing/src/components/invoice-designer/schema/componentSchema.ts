import { DEFAULT_INVOICE_PRINT_SETTINGS, resolveTemplatePrintSettings } from '@alga-psa/types';
import {
  AlignCenter,
  AlignJustify,
  AlignHorizontalDistributeCenter,
  AlignHorizontalSpaceAround,
  AlignHorizontalSpaceBetween,
  AlignLeft,
  AlignRight,
} from 'lucide-react';
import type {
  DesignerComponentType,
  DesignerContainerLayout,
  DesignerNodeStyle,
  Size,
} from '../state/designerStore';
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

const DEFAULT_RESOLVED_PRINT_SETTINGS = resolveTemplatePrintSettings({
  printSettings: DEFAULT_INVOICE_PRINT_SETTINGS,
});

export interface DesignerComponentSchema {
  type: DesignerComponentType;
  label: string;
  description: string;
  category: DesignerComponentCategory;
  defaults: DesignerComponentDefaults;
  hierarchy: DesignerComponentHierarchy;

  inspector?: DesignerInspectorSchema;
}

// Column ids only need to be unique within their table; these match the shipped
// templates. Proportional CSS widths render identically on canvas and document.
// Headers are standard labels, so they render in each recipient's language like shipped templates.
const translatedHeader = (i18nKey: string, defaultValue: string) => ({
  header: defaultValue,
  __astHeaderI18n: { i18nKey, defaultValue },
});

const createDefaultLineItemColumns = () => [
  { id: 'description', ...translatedHeader('labels.description', 'Description'), key: 'item.description', type: 'text', style: { inline: { width: '50%' } } },
  { id: 'quantity', ...translatedHeader('labels.qty', 'Qty'), key: 'item.quantity', type: 'number', style: { inline: { width: '14%', textAlign: 'right' } } },
  { id: 'unit-price', ...translatedHeader('labels.rate', 'Rate'), key: 'item.unitPrice', type: 'currency', style: { inline: { width: '18%', textAlign: 'right' } } },
  { id: 'line-total', ...translatedHeader('labels.amount', 'Amount'), key: 'item.total', type: 'currency', style: { inline: { width: '18%', textAlign: 'right' } } },
];

/**
 * The page is a plain vertical stack with the print margin as padding. No gap:
 * the rendered document puts nothing between top-level blocks, so neither may
 * the canvas.
 */
export const createPageLayout = (padding: string): DesignerContainerLayout => ({
  display: 'flex',
  flexDirection: 'column',
  gap: '0px',
  padding,
  justifyContent: 'flex-start',
  alignItems: 'stretch',
});

const mergeInspectorSchemas = (...schemas: Array<DesignerInspectorSchema | undefined>): DesignerInspectorSchema => ({
  panels: schemas.flatMap((schema) => schema?.panels ?? []),
});

const FILTERED_CONTAINER_LAYOUT_FIELD_IDS = new Set(['display', 'flexDirection', 'alignItems', 'justifyContent']);

const toContainerInspectorSchema = (schema: DesignerInspectorSchema): DesignerInspectorSchema => ({
  panels: schema.panels.map((panel) => {
    if (panel.id !== 'layout') {
      return panel;
    }
    return {
      ...panel,
      fields: panel.fields.filter((field) => !FILTERED_CONTAINER_LAYOUT_FIELD_IDS.has(field.id)),
    };
  }),
});

const COMMON_INSPECTOR: DesignerInspectorSchema = {
  panels: [
    {
      id: 'layout',
      title: 'Layout',
      tab: 'layout',
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
          kind: 'css-length-stepper',
          id: 'gap',
          label: 'Gap',
          path: 'layout.gap',
          allowedUnits: ['px', '%', 'rem'],
          defaultUnit: 'px',
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
      id: 'appearance',
      title: 'Appearance',
      tab: 'style',
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
          // Leaf text colors live in the Typography panel; containers set the
          // color their children inherit.
          visibleWhen: { kind: 'nodeIsContainer' },
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
        // Padding sits here for every block; a container's lives on its layout.
        {
          kind: 'css-length-box',
          id: 'containerPadding',
          label: 'Padding',
          path: 'layout.padding',
          allowedUnits: ['px', '%', 'rem'],
          defaultUnit: 'px',
          visibleWhen: { kind: 'nodeIsContainer' },
        },
        {
          kind: 'css-length-box',
          id: 'padding',
          label: 'Padding',
          path: 'style.padding',
          allowedUnits: ['px', '%', 'rem'],
          defaultUnit: 'px',
          visibleWhen: { kind: 'nodeIsLeaf' },
        },
        {
          kind: 'css-length-box',
          id: 'margin',
          label: 'Margin',
          path: 'style.margin',
          allowedUnits: ['px', '%', 'rem'],
          defaultUnit: 'px',
        },
      ],
    },
  ],
};

const CONTAINER_INSPECTOR = toContainerInspectorSchema(COMMON_INSPECTOR);

const createTypographyPanel = (
  id: string,
  title: string
): DesignerInspectorSchema['panels'][number] => ({
  id,
  title,
  tab: 'style',
  fields: [
    {
      kind: 'css-length-stepper',
      id: 'fontSize',
      label: 'Size',
      path: 'style.fontSize',
      allowedUnits: ['px', 'rem'],
      defaultUnit: 'px',
    },
    {
      kind: 'enum',
      id: 'fontWeight',
      label: 'Weight',
      path: 'style.fontWeight',
      options: [
        { value: '', label: 'Default' },
        { value: '400', label: 'Normal (400)' },
        { value: '500', label: 'Medium (500)' },
        { value: '600', label: 'Semibold (600)' },
        { value: '700', label: 'Bold (700)' },
      ],
    },
    {
      kind: 'string',
      id: 'lineHeight',
      label: 'Line height',
      path: 'style.lineHeight',
      placeholder: '1.4 | 18px',
    },
    {
      kind: 'icon-enum',
      id: 'textAlign',
      label: 'Align',
      path: 'style.textAlign',
      columns: 4,
      options: [
        { value: 'left', label: 'Left', icon: AlignLeft },
        { value: 'center', label: 'Center', icon: AlignCenter },
        { value: 'right', label: 'Right', icon: AlignRight },
        { value: 'justify', label: 'Justify', icon: AlignJustify },
      ],
    },
    {
      kind: 'enum',
      id: 'fontStyle',
      label: 'Style',
      path: 'style.fontStyle',
      options: [
        { value: '', label: 'Default' },
        { value: 'normal', label: 'Normal' },
        { value: 'italic', label: 'Italic' },
      ],
    },
    {
      kind: 'css-color',
      id: 'color',
      label: 'Color',
      path: 'style.color',
      placeholder: '#111827',
    },
  ],
});

const TYPOGRAPHY_INSPECTOR: DesignerInspectorSchema = {
  panels: [createTypographyPanel('typography', 'Typography')],
};

const VALUE_TYPOGRAPHY_INSPECTOR: DesignerInspectorSchema = {
  panels: [createTypographyPanel('value-typography', 'Value Text')],
};

const SECTION_INSPECTOR: DesignerInspectorSchema = {
  panels: [
    {
      id: 'section-border',
      title: 'Section Border',
      tab: 'style',
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

const createLabelStylePanel = (): DesignerInspectorSchema['panels'][number] => ({
  id: 'label-style',
  title: 'Label Style',
  tab: 'style',
  fields: [
    {
      kind: 'enum',
      id: 'labelFontWeight',
      domId: 'designer-label-font-weight',
      label: 'Weight',
      path: 'metadata.labelStyle.inline.fontWeight',
      options: [
        { value: '', label: 'Default' },
        { value: '400', label: 'Normal (400)' },
        { value: '500', label: 'Medium (500)' },
        { value: '600', label: 'Semibold (600)' },
        { value: '700', label: 'Bold (700)' },
      ],
    },
    {
      kind: 'css-length-stepper',
      id: 'labelFontSize',
      domId: 'designer-label-font-size',
      label: 'Size',
      path: 'metadata.labelStyle.inline.fontSize',
      allowedUnits: ['px', 'rem'],
      defaultUnit: 'px',
    },
    {
      kind: 'css-color',
      id: 'labelColor',
      domId: 'designer-label-color',
      label: 'Color',
      path: 'metadata.labelStyle.inline.color',
      placeholder: '#111827',
    },
    {
      kind: 'string',
      id: 'labelFontFamily',
      domId: 'designer-label-font-family',
      label: 'Font family',
      path: 'metadata.labelStyle.inline.fontFamily',
      placeholder: 'Inter, sans-serif',
    },
    {
      kind: 'string',
      id: 'labelLineHeight',
      domId: 'designer-label-line-height',
      label: 'Line height',
      path: 'metadata.labelStyle.inline.lineHeight',
      placeholder: '1.35 | 18px',
    },
    {
      kind: 'enum',
      id: 'labelFontStyle',
      domId: 'designer-label-font-style',
      label: 'Style',
      path: 'metadata.labelStyle.inline.fontStyle',
      options: [
        { value: '', label: 'Default' },
        { value: 'normal', label: 'Normal' },
        { value: 'italic', label: 'Italic' },
      ],
    },
    {
      kind: 'enum',
      id: 'labelTextAlign',
      domId: 'designer-label-text-align',
      label: 'Text align',
      path: 'metadata.labelStyle.inline.textAlign',
      options: [
        { value: '', label: 'Default' },
        { value: 'left', label: 'Left' },
        { value: 'center', label: 'Center' },
        { value: 'right', label: 'Right' },
      ],
    },
  ],
});

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
          translation: 'node-label',
        },
        {
          kind: 'widget',
          id: 'bindingKey',
          widget: 'field-binding-picker',
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
          designerOnly: true,
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
    createLabelStylePanel(),
    {
      id: 'field-layout',
      title: 'Field Layout',
      tab: 'layout',
      fields: [
        {
          kind: 'icon-enum',
          id: 'fieldJustifyContent',
          domId: 'designer-field-justify-content',
          label: 'Label / Value Alignment',
          path: 'style.justifyContent',
          columns: 3,
          options: [
            {
              value: 'space-between',
              label: 'Space Between',
              tooltip: 'Push label and value to opposite edges',
              icon: AlignHorizontalSpaceBetween,
            },
            {
              value: 'flex-start',
              label: 'Start',
              tooltip: 'Keep label and value packed at the start',
              icon: AlignLeft,
            },
            {
              value: 'center',
              label: 'Center',
              tooltip: 'Center label and value together',
              icon: AlignCenter,
            },
            {
              value: 'flex-end',
              label: 'End',
              tooltip: 'Pack label and value at the end',
              icon: AlignRight,
            },
            {
              value: 'space-around',
              label: 'Space Around',
              tooltip: 'Distribute label and value with space around each',
              icon: AlignHorizontalSpaceAround,
            },
            {
              value: 'space-evenly',
              label: 'Space Evenly',
              tooltip: 'Distribute label and value with even spacing',
              icon: AlignHorizontalDistributeCenter,
            },
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
          enableExpressionInsert: true,
          translation: 'text-content',
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
          translation: 'node-label',
        },
        {
          kind: 'string',
          id: 'bindingKey',
          domId: 'designer-total-binding',
          label: 'Binding key',
          path: 'metadata.bindingKey',
          enableExpressionInsert: true,
        },
      ],
    },
    createLabelStylePanel(),
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
          translation: 'node-label',
        },
        {
          kind: 'string',
          id: 'bindingKey',
          domId: 'designer-total-binding',
          label: 'Binding key',
          path: 'metadata.bindingKey',
          enableExpressionInsert: true,
        },
        {
          kind: 'textarea',
          id: 'notes',
          label: 'Computation notes',
          path: 'metadata.notes',
        },
      ],
    },
    createLabelStylePanel(),
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
          kind: 'widget',
          id: 'tableEditor',
          widget: 'table-editor',
        },
      ],
    },
    {
      id: 'table-header-style',
      title: 'Header Style',
      tab: 'style',
      fields: [
        {
          kind: 'css-color',
          id: 'headerBackgroundColor',
          label: 'Background',
          path: 'metadata.headerBackgroundColor',
          placeholder: '#1f2937',
        },
        {
          kind: 'css-color',
          id: 'headerColor',
          label: 'Text color',
          path: 'metadata.headerColor',
          placeholder: '#ffffff',
        },
      ],
    },
  ],
};

const TOTALS_ROWS_INSPECTOR: DesignerInspectorSchema = {
  panels: [
    {
      id: 'totals-rows',
      title: 'Totals Rows',
      fields: [
        {
          kind: 'widget',
          id: 'totalsRows',
          domId: 'designer-totals-rows-editor',
          widget: 'totals-rows-editor',
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
      size: {
        width: DEFAULT_RESOLVED_PRINT_SETTINGS.pageWidthPx,
        height: DEFAULT_RESOLVED_PRINT_SETTINGS.pageHeightPx,
      },
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
      size: {
        width: DEFAULT_RESOLVED_PRINT_SETTINGS.pageWidthPx,
        height: DEFAULT_RESOLVED_PRINT_SETTINGS.pageHeightPx,
      },
      layout: createPageLayout(`${DEFAULT_RESOLVED_PRINT_SETTINGS.marginPx}px`),
      metadata: {},
    },
    hierarchy: {
      // The page is a vertical stack like any container: blocks sit on it
      // directly, and sections are an optional grouping, not a prerequisite.
      allowedChildren: [
        'section',
        'container',
        'text',
        'richText',
        'field',
        'label',
        'subtotal',
        'tax',
        'discount',
        'custom-total',
        'totals',
        'table',
        'dynamic-table',
        'image',
        'logo',
        'qr',
        'signature',
        'attachment-list',
        'action-button',
        'divider',
        'spacer',
      ],
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
        'richText',
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
    inspector: mergeInspectorSchemas(CONTAINER_INSPECTOR, SECTION_INSPECTOR),
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
        'richText',
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
      // Empty, so typing starts fresh; the canvas shows a "Text" placeholder meanwhile.
      metadata: {
        text: '',
      },
    },
    hierarchy: {
      allowedChildren: [],
      allowedParents: ['page', 'column', 'container', 'section'],
    },
    inspector: mergeInspectorSchemas(TEXT_INSPECTOR, TYPOGRAPHY_INSPECTOR, COMMON_INSPECTOR),
  },
  richText: {
    type: 'richText',
    label: 'Rich Text',
    description: 'Terms or copy authored as structured rich text (links, bold, paragraphs).',
    category: 'Content',
    defaults: {
      size: { width: 320, height: 80 },
      metadata: {
        text: '',
      },
    },
    hierarchy: {
      allowedChildren: [],
      allowedParents: ['page', 'column', 'container', 'section'],
    },
    inspector: mergeInspectorSchemas(TEXT_INSPECTOR, TYPOGRAPHY_INSPECTOR, COMMON_INSPECTOR),
  },
  totals: {
    type: 'totals',
    label: 'Totals',
    description: 'Subtotal/Tax/Grand total summary.',
    category: 'Content',
    defaults: {
      size: { width: 360, height: 140 },
      // A summary box: invoice-width, on the right, under the line items.
      style: {
        width: '300px',
        height: 'auto',
        margin: '0px 0px 0px auto',
      },
      metadata: {
        // Same rows the exporter falls back to, materialized so they can be edited.
        totalsRows: [
          { id: 'subtotal', label: 'Subtotal', __astLabelI18n: { i18nKey: 'labels.subtotal', defaultValue: 'Subtotal' }, valuePath: 'subtotal', format: 'currency', type: 'currency', emphasize: false },
          { id: 'tax', label: 'Tax', __astLabelI18n: { i18nKey: 'labels.tax', defaultValue: 'Tax' }, valuePath: 'tax', format: 'currency', type: 'currency', emphasize: false },
          { id: 'total', label: 'Total', __astLabelI18n: { i18nKey: 'labels.total', defaultValue: 'Total' }, valuePath: 'total', format: 'currency', type: 'currency', emphasize: true },
        ],
      },
    },
    hierarchy: {
      allowedChildren: [],
      allowedParents: ['page', 'column', 'container', 'section'],
    },
    inspector: mergeInspectorSchemas(TOTALS_ROWS_INSPECTOR, TYPOGRAPHY_INSPECTOR, COMMON_INSPECTOR),
  },
  table: {
    type: 'table',
    label: 'Line Items Table',
    description: 'Repeating rows for invoice line items.',
    category: 'Dynamic',
    defaults: {
      size: { width: 520, height: 220 },
      style: {
        width: '100%',
        height: 'auto',
      },
      metadata: {
        columns: createDefaultLineItemColumns(),
        tableBorderPreset: 'boxed',
        tableOuterBorder: true,
        tableRowDividers: true,
        tableColumnDividers: false,
        tableHeaderFontWeight: 'semibold',
      },
    },
    hierarchy: {
      allowedChildren: [],
      allowedParents: ['page', 'column', 'container', 'section'],
    },
    inspector: mergeInspectorSchemas(TABLE_INSPECTOR, COMMON_INSPECTOR),
  },
  'dynamic-table': {
    type: 'dynamic-table',
    label: 'Dynamic Table',
    description: 'Advanced data table with column bindings.',
    category: 'Dynamic',
    defaults: {
      size: { width: 520, height: 240 },
      style: {
        width: '100%',
        height: 'auto',
      },
      metadata: {
        // The columns the canvas shows for an unconfigured table, made real so
        // the inspector and canvas agree from the start.
        columns: createDefaultLineItemColumns(),
        tableBorderPreset: 'boxed',
        tableOuterBorder: true,
        tableRowDividers: true,
        tableColumnDividers: false,
        tableHeaderFontWeight: 'semibold',
      },
    },
    hierarchy: {
      allowedChildren: [],
      allowedParents: ['page', 'column', 'container', 'section'],
    },
    inspector: mergeInspectorSchemas(TABLE_INSPECTOR, COMMON_INSPECTOR),
  },
  field: {
    type: 'field',
    label: 'Data Field',
    description: 'Displays a bound value (invoice number, dates, totals).',
    category: 'Content',
    defaults: {
      size: { width: 200, height: 48 },
      style: {
        width: 'auto',
        height: 'auto',
        justifyContent: 'space-between',
      },
      metadata: {
        bindingKey: 'invoice.number',
        // Labelled like its default binding, translated for each recipient.
        label: 'Invoice #',
        __astLabelI18n: { i18nKey: 'labels.invoiceNumber', defaultValue: 'Invoice #' },
        format: 'text',
        placeholder: 'Invoice Number',
        fieldBorderStyle: 'none',
      },
    },
    hierarchy: {
      allowedChildren: [],
      allowedParents: ['page', 'column', 'container', 'section'],
    },
    inspector: mergeInspectorSchemas(FIELD_INSPECTOR, VALUE_TYPOGRAPHY_INSPECTOR, COMMON_INSPECTOR),
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
      allowedParents: ['page', 'column', 'container', 'section'],
    },
    inspector: mergeInspectorSchemas(LABEL_INSPECTOR, TYPOGRAPHY_INSPECTOR, COMMON_INSPECTOR),
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
      allowedParents: ['page', 'column', 'container', 'section'],
    },
    inspector: mergeInspectorSchemas(TOTALS_ROW_INSPECTOR, TYPOGRAPHY_INSPECTOR, COMMON_INSPECTOR),
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
      allowedParents: ['page', 'column', 'container', 'section'],
    },
    inspector: mergeInspectorSchemas(TOTALS_ROW_INSPECTOR, TYPOGRAPHY_INSPECTOR, COMMON_INSPECTOR),
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
      allowedParents: ['page', 'column', 'container', 'section'],
    },
    inspector: mergeInspectorSchemas(TOTALS_ROW_INSPECTOR, TYPOGRAPHY_INSPECTOR, COMMON_INSPECTOR),
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
      allowedParents: ['page', 'column', 'container', 'section'],
    },
    inspector: mergeInspectorSchemas(CUSTOM_TOTAL_INSPECTOR, TYPOGRAPHY_INSPECTOR, COMMON_INSPECTOR),
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
      allowedParents: ['column', 'container', 'section', 'page'],
    },
    inspector: COMMON_INSPECTOR,
  },
  logo: {
    type: 'logo',
    label: 'Logo',
    description: 'Your company logo from branding settings.',
    category: 'Media',
    defaults: {
      size: { width: 180, height: 72 },
      // A letterhead-sized frame (from `size`), left-aligned, never taller than 72px.
      style: {
        maxHeight: '72px',
        objectFit: 'contain',
        objectPosition: 'left center',
      },
      metadata: {
        srcBinding: 'tenantLogo',
      },
    },
    hierarchy: {
      allowedChildren: [],
      allowedParents: ['column', 'container', 'section', 'page'],
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
      allowedParents: ['column', 'container', 'section', 'page'],
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
      allowedParents: ['column', 'container', 'section', 'page'],
    },
    inspector: mergeInspectorSchemas(SIGNATURE_INSPECTOR, COMMON_INSPECTOR),
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
      allowedParents: ['column', 'container', 'section', 'page'],
    },
    inspector: mergeInspectorSchemas(ACTION_BUTTON_INSPECTOR, COMMON_INSPECTOR),
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
      allowedParents: ['column', 'container', 'section', 'page'],
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
      allowedParents: ['page', 'column', 'container', 'section'],
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
      allowedParents: ['page', 'column', 'container', 'section'],
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
      // A plain grouping box: no inner padding until it is styled as a card.
      layout: {
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
        padding: '0px',
        justifyContent: 'flex-start',
        alignItems: 'stretch',
      },
      metadata: {},
    },
    hierarchy: {
      allowedChildren: [
        'text',
        'richText',
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
      allowedParents: ['page', 'column', 'container', 'section'],
    },
    inspector: CONTAINER_INSPECTOR,
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
