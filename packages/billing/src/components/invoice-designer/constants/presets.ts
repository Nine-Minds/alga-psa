import type { DesignerComponentType, DesignerContainerLayout, DesignerNodeStyle, Point, Size } from '../state/designerStore';
import { BILLED_TIME_PRESETS } from './billedTimePresets';
import { createLabelTranslationMetadata, createTextTranslationMetadata } from '../utils/translatableText';

// Legacy preset layouts still use the pre-CSS cutover shape. We accept both so presets
// can be migrated incrementally while the live designer uses CSS-like layout state.
export type LegacyLayoutPresetLayout = {
  mode?: 'canvas' | 'flex';
  direction?: 'row' | 'column';
  gap?: number;
  padding?: number;
  justify?: 'start' | 'center' | 'end' | 'space-between';
  align?: 'start' | 'center' | 'end' | 'stretch';
  sizing?: 'fixed' | 'hug' | 'fill';
};

export type LayoutPresetConstraintDefinition =
  | {
      type: 'aspect-ratio';
      node: string;
      ratio: number;
      strength?: 'required' | 'strong' | 'medium' | 'weak';
    };

export interface LayoutPresetNodeDefinition {
  key: string;
  type: DesignerComponentType;
  offset: Point;
  size?: Size;
  name?: string;
  parentKey?: string;
  layout?: Partial<DesignerContainerLayout> | LegacyLayoutPresetLayout;
  style?: Partial<DesignerNodeStyle>;
  metadata?: Record<string, unknown>;
}

export interface LayoutPresetDefinition {
  documentKind?: 'invoice' | 'quote' | 'sales-order';
  id: string;
  label: string;
  description: string;
  category: 'Header' | 'Body' | 'Footer';
  nodes: LayoutPresetNodeDefinition[];
  constraints?: LayoutPresetConstraintDefinition[];
}

// Stacked cell lines for quote line-item name + catalog description. When the
// column renders, each non-empty line stacks on its own row above the column's
// single-value fallback (the editable line description). Shared by the quote
// grouped-table presets below; the designer workspace map and the export path
// preserve these as optional `lines` on the table column AST.
const QUOTE_ITEM_NAME_CATALOG_LINES = [
  {
    id: 'item-name',
    key: 'item.service_name',
    style: { inline: { fontWeight: 600, lineHeight: 1.35 } },
  },
  {
    id: 'catalog-description',
    key: 'item.catalog_description',
    style: { inline: { color: '#4b5563', fontSize: '12px', lineHeight: 1.4 } },
  },
];

export const LAYOUT_PRESETS: LayoutPresetDefinition[] = [
  ...BILLED_TIME_PRESETS,
  {
    // The header of the shipped Detailed invoice: issuer brand beside an
    // invoice-details card, with bindings and translated labels already set.
    id: 'header-logo-address',
    documentKind: 'invoice',
    label: 'Header: Logo + Invoice Details',
    description: 'Company logo, name and address beside a card with the invoice number and dates.',
    category: 'Header',
    nodes: [
      {
        key: 'header',
        type: 'container',
        offset: { x: 0, y: 0 },
        name: 'header-top',
        layout: { display: 'flex', flexDirection: 'row', gap: '24px', padding: '0px', justifyContent: 'space-between', alignItems: 'flex-start' },
        style: { margin: '0px 0px 20px' },
      },
      {
        key: 'brand',
        type: 'container',
        parentKey: 'header',
        offset: { x: 0, y: 0 },
        name: 'issuer-brand',
        layout: { display: 'flex', flexDirection: 'column', gap: '6px', padding: '0px', justifyContent: 'flex-start', alignItems: 'stretch' },
      },
      {
        key: 'logo',
        type: 'logo',
        parentKey: 'brand',
        offset: { x: 0, y: 0 },
        size: { width: 180, height: 72 },
        name: 'issuer-logo',
        style: { margin: '0px 0px 6px' },
      },
      {
        key: 'company-name',
        type: 'text',
        parentKey: 'brand',
        offset: { x: 0, y: 0 },
        name: 'issuer-name',
        style: { fontSize: '18px', fontWeight: '700', lineHeight: '1.2' },
        metadata: { text: '{{tenant.name}}' },
      },
      {
        key: 'company-address',
        type: 'text',
        parentKey: 'brand',
        offset: { x: 0, y: 0 },
        name: 'issuer-address',
        style: { color: '#4b5563', lineHeight: '1.4' },
        metadata: { text: '{{tenant.address}}' },
      },
      {
        key: 'details',
        type: 'container',
        parentKey: 'header',
        offset: { x: 0, y: 0 },
        name: 'invoice-meta-card',
        layout: { display: 'flex', flexDirection: 'column', gap: '6px', padding: '14px 16px', justifyContent: 'flex-start', alignItems: 'stretch' },
        style: { minWidth: '280px', border: '1px solid #d1d5db', borderRadius: '10px', backgroundColor: '#f9fafb' },
      },
      {
        key: 'title',
        type: 'text',
        parentKey: 'details',
        offset: { x: 0, y: 0 },
        name: 'invoice-title',
        style: { margin: '0px 0px 4px', fontSize: '22px', fontWeight: '700', lineHeight: '1.1' },
        metadata: createTextTranslationMetadata({ i18nKey: 'labels.invoiceTitle', defaultValue: 'INVOICE' }),
      },
      ...([
        ['invoice-number', 'invoice.number', 'labels.invoiceNumber', 'Invoice #', 'text', undefined],
        ['issue-date', 'invoice.issueDate', 'labels.issueDate', 'Issue Date', 'date', undefined],
        ['due-date', 'invoice.dueDate', 'labels.dueDate', 'Due Date', 'date', undefined],
        ['po-number', 'invoice.poNumber', 'labels.poNumber', 'PO #', 'text', '-'],
      ] as const).map(([name, bindingKey, i18nKey, label, format, emptyValue]): LayoutPresetNodeDefinition => ({
        key: name,
        type: 'field',
        parentKey: 'details',
        offset: { x: 0, y: 0 },
        name,
        style: { justifyContent: 'space-between' },
        metadata: {
          bindingKey,
          format,
          placeholder: label,
          fieldBorderStyle: 'none',
          ...createLabelTranslationMetadata({ i18nKey, defaultValue: label }),
          ...(emptyValue ? { emptyValue } : {}),
        },
      })),
    ],
  },
  {
    id: 'line-items-table',
    label: 'Line Items Table',
    description: 'Full-width items table with repeating rows.',
    category: 'Body',
    nodes: [
      { 
        key: 'section', 
        type: 'section', 
        offset: { x: 0, y: 0 }, 
        size: { width: 520, height: 320 }, 
        name: 'Items Section',
        layout: {
          display: 'flex',
          flexDirection: 'column',
          gap: '0px',
          padding: '20px',
          justifyContent: 'flex-start',
          alignItems: 'stretch',
        }
      },
      {
        key: 'column',
        type: 'container',
        parentKey: 'section',
        offset: { x: 0, y: 0 },
        size: { width: 520, height: 320 },
        name: 'Items Column',
        layout: {
          display: 'flex',
          flexDirection: 'column',
          gap: '0px',
          padding: '0px',
          justifyContent: 'flex-start',
          alignItems: 'stretch',
        }
      },
      {
        key: 'table',
        type: 'table',
        parentKey: 'column',
        offset: { x: 0, y: 0 },
        size: { width: 520, height: 260 },
        name: 'Line Items',
        layout: {
          display: 'flex', // Tables are leaves but can use flex props for self-sizing context
          flexDirection: 'column',
          gap: '0px',
          padding: '0px',
          justifyContent: 'flex-start',
          alignItems: 'stretch',
        }
      },
    ],
  },
  {
    id: 'totals-stack',
    label: 'Totals Stack',
    description: 'Totals summary with note block.',
    category: 'Footer',
    nodes: [
      { 
        key: 'section', 
        type: 'section', 
        offset: { x: 0, y: 0 }, 
        size: { width: 560, height: 200 }, 
        name: 'Totals Section',
        layout: {
          display: 'flex',
          flexDirection: 'row',
          gap: '40px',
          padding: '20px',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
        }
      },
      {
        key: 'column-note',
        type: 'container',
        parentKey: 'section',
        offset: { x: 0, y: 0 },
        size: { width: 260, height: 180 },
        name: 'Notes Column',
        layout: {
          display: 'flex',
          flexDirection: 'column',
          gap: '10px',
          padding: '0px',
          justifyContent: 'flex-start',
          alignItems: 'stretch',
        }
      },
      {
        key: 'column-totals',
        type: 'container',
        parentKey: 'section',
        offset: { x: 0, y: 0 },
        size: { width: 280, height: 180 },
        name: 'Totals Column',
        layout: {
          display: 'flex',
          flexDirection: 'column',
          gap: '10px',
          padding: '0px',
          justifyContent: 'flex-start',
          alignItems: 'flex-end',
        }
      },
      {
        key: 'note',
        type: 'text',
        parentKey: 'column-note',
        offset: { x: 0, y: 0 },
        size: { width: 240, height: 80 },
        name: 'Notes',
      },
      {
        key: 'totals',
        type: 'totals',
        parentKey: 'column-totals',
        offset: { x: 0, y: 0 },
        size: { width: 280, height: 160 },
        name: 'Totals',
      },
    ],
  },
  {
    id: 'two-column-summary',
    label: 'Two-Column Summary',
    description: 'Equal columns for summary and contact info.',
    category: 'Body',
    nodes: [
      { 
        key: 'section', 
        type: 'section', 
        offset: { x: 0, y: 0 }, 
        size: { width: 560, height: 200 }, 
        name: 'Summary Section',
        layout: {
          display: 'flex',
          flexDirection: 'row',
          gap: '20px',
          padding: '20px',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
        }
      },
      {
        key: 'column-left',
        type: 'container',
        parentKey: 'section',
        offset: { x: 0, y: 0 },
        size: { width: 260, height: 180 },
        name: 'Summary Column',
        layout: {
          display: 'flex',
          flexDirection: 'column',
          gap: '10px',
          padding: '0px',
          justifyContent: 'flex-start',
          alignItems: 'stretch',
        }
      },
      {
        key: 'column-right',
        type: 'container',
        parentKey: 'section',
        offset: { x: 0, y: 0 },
        size: { width: 260, height: 180 },
        name: 'Contact Column',
        layout: {
          display: 'flex',
          flexDirection: 'column',
          gap: '10px',
          padding: '0px',
          justifyContent: 'flex-start',
          alignItems: 'stretch',
        }
      },
      {
        key: 'summary',
        type: 'text',
        parentKey: 'column-left',
        offset: { x: 0, y: 0 },
        size: { width: 240, height: 160 },
        name: 'Summary',
      },
      {
        key: 'contact',
        type: 'text',
        parentKey: 'column-right',
        offset: { x: 0, y: 0 },
        size: { width: 240, height: 160 },
        name: 'Contact Info',
      },
    ],
  },
  {
    id: 'notes-totals-row',
    label: 'Notes + Totals Row',
    description: 'Wide notes column beside a narrow totals column using CSS grid.',
    category: 'Body',
    nodes: [
      {
        key: 'section',
        type: 'section',
        offset: { x: 0, y: 0 },
        size: { width: 640, height: 220 },
        name: 'Notes + Totals Row',
        layout: {
          display: 'grid',
          gridTemplateColumns: '2fr 1fr',
          gap: '20px',
          padding: '20px',
          alignItems: 'stretch',
        },
      },
      {
        key: 'notes-column',
        type: 'container',
        parentKey: 'section',
        offset: { x: 0, y: 0 },
        size: { width: 380, height: 180 },
        name: 'Notes Column',
        layout: {
          display: 'flex',
          flexDirection: 'column',
          gap: '12px',
          padding: '0px',
          justifyContent: 'flex-start',
          alignItems: 'stretch',
        },
      },
      {
        key: 'totals-column',
        type: 'container',
        parentKey: 'section',
        offset: { x: 0, y: 0 },
        size: { width: 200, height: 180 },
        name: 'Totals Column',
        layout: {
          display: 'flex',
          flexDirection: 'column',
          gap: '12px',
          padding: '0px',
          justifyContent: 'flex-start',
          alignItems: 'stretch',
        },
      },
      {
        key: 'notes',
        type: 'text',
        parentKey: 'notes-column',
        offset: { x: 0, y: 0 },
        size: { width: 360, height: 140 },
        name: 'Notes',
      },
      {
        key: 'totals',
        type: 'totals',
        parentKey: 'totals-column',
        offset: { x: 0, y: 0 },
        size: { width: 200, height: 160 },
        name: 'Totals',
      },
    ],
  },
  {
    id: 'two-equal-columns-grid',
    label: 'Two Equal Columns',
    description: 'Balanced two-column body section using CSS grid.',
    category: 'Body',
    nodes: [
      {
        key: 'section',
        type: 'section',
        offset: { x: 0, y: 0 },
        size: { width: 620, height: 220 },
        name: 'Two Equal Columns',
        layout: {
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: '20px',
          padding: '20px',
          alignItems: 'stretch',
        },
      },
      {
        key: 'left-column',
        type: 'container',
        parentKey: 'section',
        offset: { x: 0, y: 0 },
        size: { width: 280, height: 180 },
        name: 'Left Column',
        layout: {
          display: 'flex',
          flexDirection: 'column',
          gap: '10px',
          padding: '0px',
          justifyContent: 'flex-start',
          alignItems: 'stretch',
        },
      },
      {
        key: 'right-column',
        type: 'container',
        parentKey: 'section',
        offset: { x: 0, y: 0 },
        size: { width: 280, height: 180 },
        name: 'Right Column',
        layout: {
          display: 'flex',
          flexDirection: 'column',
          gap: '10px',
          padding: '0px',
          justifyContent: 'flex-start',
          alignItems: 'stretch',
        },
      },
      {
        key: 'left-text',
        type: 'text',
        parentKey: 'left-column',
        offset: { x: 0, y: 0 },
        size: { width: 260, height: 150 },
        name: 'Left Content',
      },
      {
        key: 'right-text',
        type: 'text',
        parentKey: 'right-column',
        offset: { x: 0, y: 0 },
        size: { width: 260, height: 150 },
        name: 'Right Content',
      },
    ],
  },
  {
    id: 'three-info-columns',
    label: 'Three Info Columns',
    description: 'Three-column info-card row using CSS grid.',
    category: 'Body',
    nodes: [
      {
        key: 'section',
        type: 'section',
        offset: { x: 0, y: 0 },
        size: { width: 720, height: 220 },
        name: 'Three Info Columns',
        layout: {
          display: 'grid',
          gridTemplateColumns: '1fr 1fr 1fr',
          gap: '16px',
          padding: '20px',
          alignItems: 'stretch',
        },
      },
      {
        key: 'column-a',
        type: 'container',
        parentKey: 'section',
        offset: { x: 0, y: 0 },
        size: { width: 210, height: 180 },
        name: 'Info Column A',
        layout: {
          display: 'flex',
          flexDirection: 'column',
          gap: '10px',
          padding: '0px',
          justifyContent: 'flex-start',
          alignItems: 'stretch',
        },
      },
      {
        key: 'column-b',
        type: 'container',
        parentKey: 'section',
        offset: { x: 0, y: 0 },
        size: { width: 210, height: 180 },
        name: 'Info Column B',
        layout: {
          display: 'flex',
          flexDirection: 'column',
          gap: '10px',
          padding: '0px',
          justifyContent: 'flex-start',
          alignItems: 'stretch',
        },
      },
      {
        key: 'column-c',
        type: 'container',
        parentKey: 'section',
        offset: { x: 0, y: 0 },
        size: { width: 210, height: 180 },
        name: 'Info Column C',
        layout: {
          display: 'flex',
          flexDirection: 'column',
          gap: '10px',
          padding: '0px',
          justifyContent: 'flex-start',
          alignItems: 'stretch',
        },
      },
      {
        key: 'text-a',
        type: 'text',
        parentKey: 'column-a',
        offset: { x: 0, y: 0 },
        size: { width: 190, height: 140 },
        name: 'Info A',
      },
      {
        key: 'text-b',
        type: 'text',
        parentKey: 'column-b',
        offset: { x: 0, y: 0 },
        size: { width: 190, height: 140 },
        name: 'Info B',
      },
      {
        key: 'text-c',
        type: 'text',
        parentKey: 'column-c',
        offset: { x: 0, y: 0 },
        size: { width: 190, height: 140 },
        name: 'Info C',
      },
    ],
  },
  {
    id: 'recurring-onetime-tables',
    label: 'Recurring + One-time Tables',
    description: 'Quote-ready stacked dynamic tables for recurring and one-time items.',
    category: 'Body',
    nodes: [
      {
        key: 'section',
        type: 'section',
        offset: { x: 0, y: 0 },
        size: { width: 640, height: 440 },
        name: 'Recurring + One-time Tables',
        layout: {
          display: 'grid',
          gridTemplateColumns: '1fr',
          gap: '20px',
          padding: '20px',
          alignItems: 'stretch',
        },
      },
      {
        key: 'recurring-table',
        type: 'dynamic-table',
        parentKey: 'section',
        offset: { x: 0, y: 0 },
        size: { width: 600, height: 180 },
        name: 'Recurring Items',
        metadata: {
          collectionBindingKey: 'recurringItems',
          columns: [
            { id: 'recurring-description', header: 'Description', key: 'item.description', type: 'text', width: 280, lines: QUOTE_ITEM_NAME_CATALOG_LINES },
            { id: 'recurring-quantity', header: 'Qty', key: 'item.quantity', type: 'number', width: 90 },
            { id: 'recurring-rate', header: 'Rate', key: 'item.unitPrice', type: 'currency', width: 120 },
            { id: 'recurring-amount', header: 'Amount', key: 'item.total', type: 'currency', width: 140 },
          ],
          tableBorderPreset: 'boxed',
          tableOuterBorder: true,
          tableRowDividers: true,
          tableColumnDividers: false,
          tableHeaderFontWeight: 'semibold',
        },
      },
      {
        key: 'onetime-table',
        type: 'dynamic-table',
        parentKey: 'section',
        offset: { x: 0, y: 0 },
        size: { width: 600, height: 180 },
        name: 'One-time Items',
        metadata: {
          collectionBindingKey: 'onetimeItems',
          columns: [
            { id: 'onetime-description', header: 'Description', key: 'item.description', type: 'text', width: 280, lines: QUOTE_ITEM_NAME_CATALOG_LINES },
            { id: 'onetime-quantity', header: 'Qty', key: 'item.quantity', type: 'number', width: 90 },
            { id: 'onetime-rate', header: 'Rate', key: 'item.unitPrice', type: 'currency', width: 120 },
            { id: 'onetime-amount', header: 'Amount', key: 'item.total', type: 'currency', width: 140 },
          ],
          tableBorderPreset: 'boxed',
          tableOuterBorder: true,
          tableRowDividers: true,
          tableColumnDividers: false,
          tableHeaderFontWeight: 'semibold',
        },
      },
    ],
  },
  {
    id: 'header-with-qr',
    label: 'Split Header with QR',
    description: 'Logo + address stack with QR code payment block.',
    category: 'Header',
    nodes: [
      { 
        key: 'section', 
        type: 'section', 
        offset: { x: 0, y: 0 }, 
        size: { width: 640, height: 200 }, 
        name: 'Split Header',
        layout: {
          mode: 'flex',
          direction: 'row',
          gap: 20,
          padding: 20,
          justify: 'space-between',
          align: 'start',
          sizing: 'hug',
        }
      },
      {
        key: 'column-logo',
        type: 'container',
        parentKey: 'section',
        offset: { x: 0, y: 0 },
        size: { width: 220, height: 180 },
        name: 'Logo Column',
        layout: {
          mode: 'flex',
          direction: 'column',
          gap: 10,
          padding: 0,
          justify: 'start',
          align: 'start',
          sizing: 'fixed',
        }
      },
      {
        key: 'column-address',
        type: 'container',
        parentKey: 'section',
        offset: { x: 0, y: 0 },
        size: { width: 220, height: 180 },
        name: 'Address Column',
        layout: {
          mode: 'flex',
          direction: 'column',
          gap: 10,
          padding: 0,
          justify: 'start',
          align: 'start',
          sizing: 'fixed', // Fixed width for address middle col
        }
      },
      {
        key: 'column-qr',
        type: 'container',
        parentKey: 'section',
        offset: { x: 0, y: 0 },
        size: { width: 140, height: 180 },
        name: 'QR Column',
        layout: {
          mode: 'flex',
          direction: 'column',
          gap: 10,
          padding: 0,
          justify: 'center',
          align: 'end',
          sizing: 'fixed',
        }
      },
      { key: 'logo', type: 'logo', parentKey: 'column-logo', offset: { x: 0, y: 0 }, size: { width: 200, height: 120 } },
      { key: 'address', type: 'text', parentKey: 'column-address', offset: { x: 0, y: 0 }, size: { width: 220, height: 140 } },
      { key: 'qr', type: 'qr', parentKey: 'column-qr', offset: { x: 0, y: 0 }, size: { width: 140, height: 140 } },
    ],
    constraints: [
      { type: 'aspect-ratio', node: 'qr', ratio: 1, strength: 'strong' },
    ],
  },
  {
    id: 'modern-invoice-complete',
    label: 'Modern Invoice Template',
    description: 'Complete layout with Header, Billing Info, Items Table, and Footer.',
    category: 'Body',
    nodes: [
      // --- Header Section ---
      {
        key: 'header-section',
        type: 'section',
        offset: { x: 0, y: 0 },
        size: { width: 750, height: 150 },
        name: 'Header',
        metadata: { sectionBorderStyle: 'none' },
        layout: { mode: 'flex', direction: 'row', gap: 20, padding: 20, justify: 'space-between', align: 'center', sizing: 'hug' }
      },
      {
        key: 'header-left',
        type: 'container',
        parentKey: 'header-section',
        offset: { x: 0, y: 0 },
        size: { width: 300, height: 100 },
        name: 'Brand Area',
        layout: { mode: 'flex', direction: 'column', gap: 8, padding: 0, justify: 'start', align: 'start', sizing: 'fill' }
      },
      {
        key: 'header-logo',
        type: 'logo',
        parentKey: 'header-left',
        offset: { x: 0, y: 0 },
        size: { width: 180, height: 80 },
        name: 'Company Logo'
      },
      {
        key: 'header-right',
        type: 'container',
        parentKey: 'header-section',
        offset: { x: 0, y: 0 },
        size: { width: 320, height: 100 },
        name: 'Invoice Details',
        layout: { mode: 'flex', direction: 'row', gap: 12, padding: 0, justify: 'end', align: 'center', sizing: 'fixed' }
      },
      {
        key: 'lbl-invoice',
        type: 'label',
        parentKey: 'header-right',
        offset: { x: 0, y: 0 },
        size: { width: 96, height: 32 },
        name: 'Invoice Number Label',
        metadata: {
          fontWeight: 'bold',
        },
      },
      {
        key: 'field-inv-num',
        type: 'field',
        parentKey: 'header-right',
        offset: { x: 0, y: 0 },
        size: { width: 212, height: 40 },
        name: 'Invoice Number',
        metadata: {
          bindingKey: 'invoice.number',
          format: 'text',
          placeholder: 'Invoice Number',
          fieldBorderStyle: 'underline',
        },
      },
      
      // --- Billing Section ---
      {
        key: 'billing-section',
        type: 'section',
        offset: { x: 0, y: 0 },
        size: { width: 750, height: 180 },
        name: 'Billing Info',
        metadata: { sectionBorderStyle: 'none' },
        layout: { mode: 'flex', direction: 'row', gap: 40, padding: 20, justify: 'start', align: 'start', sizing: 'hug' }
      },
      {
        key: 'col-from',
        type: 'container',
        parentKey: 'billing-section',
        offset: { x: 0, y: 0 },
        size: { width: 300, height: 140 },
        name: 'From Column',
        layout: { mode: 'flex', direction: 'column', gap: 8, padding: 0, justify: 'start', align: 'start', sizing: 'fill' }
      },
      {
        key: 'lbl-from',
        type: 'label',
        parentKey: 'col-from',
        offset: { x: 0, y: 0 },
        size: { width: 100, height: 24 },
        name: 'From Label',
        metadata: {
          fontWeight: 'semibold',
        },
      },
      {
        key: 'txt-from-addr',
        type: 'text',
        parentKey: 'col-from',
        offset: { x: 0, y: 0 },
        size: { width: 280, height: 80 },
        name: 'From Address',
        metadata: {
          bindingKey: 'tenant.address',
          format: 'text',
        },
      },
      {
        key: 'col-to',
        type: 'container',
        parentKey: 'billing-section',
        offset: { x: 0, y: 0 },
        size: { width: 300, height: 140 },
        name: 'Bill To Column',
        layout: { mode: 'flex', direction: 'column', gap: 8, padding: 0, justify: 'start', align: 'start', sizing: 'fill' }
      },
      {
        key: 'lbl-to',
        type: 'label',
        parentKey: 'col-to',
        offset: { x: 0, y: 0 },
        size: { width: 100, height: 24 },
        name: 'Bill To Label',
        metadata: {
          fontWeight: 'semibold',
        },
      },
      {
        key: 'txt-to-addr',
        type: 'text',
        parentKey: 'col-to',
        offset: { x: 0, y: 0 },
        size: { width: 280, height: 80 },
        name: 'Client Address',
        metadata: {
          bindingKey: 'customer.address',
          format: 'text',
        },
      },

      // --- Items Section ---
      {
        key: 'items-section',
        type: 'section',
        offset: { x: 0, y: 0 },
        size: { width: 750, height: 300 },
        name: 'Items Area',
        metadata: { sectionBorderStyle: 'none' },
        layout: { mode: 'flex', direction: 'column', gap: 0, padding: 20, justify: 'start', align: 'stretch', sizing: 'hug' }
      },
      {
        key: 'items-table',
        type: 'table',
        parentKey: 'items-section',
        offset: { x: 0, y: 0 },
        size: { width: 710, height: 200 },
        name: 'Line Items',
        metadata: {
          tableBorderPreset: 'list',
          tableOuterBorder: false,
          tableRowDividers: true,
          tableColumnDividers: false,
          tableHeaderFontWeight: 'semibold',
        },
      },

      // --- Footer Section ---
      {
        key: 'footer-section',
        type: 'section',
        offset: { x: 0, y: 0 },
        size: { width: 750, height: 200 },
        name: 'Footer',
        metadata: { sectionBorderStyle: 'none' },
        layout: { mode: 'flex', direction: 'row', gap: 20, padding: 20, justify: 'space-between', align: 'start', sizing: 'hug' }
      },
      {
        key: 'footer-notes',
        type: 'container',
        parentKey: 'footer-section',
        offset: { x: 0, y: 0 },
        size: { width: 300, height: 150 },
        name: 'Notes Area',
        layout: { mode: 'flex', direction: 'column', gap: 8, padding: 0, justify: 'start', align: 'start', sizing: 'fill' }
      },
      {
        key: 'lbl-notes',
        type: 'label',
        parentKey: 'footer-notes',
        offset: { x: 0, y: 0 },
        size: { width: 100, height: 24 },
        name: 'Notes Label',
        metadata: {
          fontWeight: 'semibold',
        },
      },
      {
        key: 'txt-notes',
        type: 'text',
        parentKey: 'footer-notes',
        offset: { x: 0, y: 0 },
        size: { width: 280, height: 100 },
        name: 'Terms Text'
      },
      {
        key: 'footer-totals',
        type: 'container',
        parentKey: 'footer-section',
        offset: { x: 0, y: 0 },
        size: { width: 280, height: 192 },
        name: 'Totals Area',
        layout: { mode: 'flex', direction: 'column', gap: 8, padding: 0, justify: 'start', align: 'stretch', sizing: 'fixed' }
      },
      {
        key: 'val-subtotal',
        type: 'subtotal',
        parentKey: 'footer-totals',
        offset: { x: 0, y: 0 },
        size: { width: 280, height: 56 },
        name: 'Subtotal'
      },
      {
        key: 'val-tax',
        type: 'tax',
        parentKey: 'footer-totals',
        offset: { x: 0, y: 0 },
        size: { width: 280, height: 56 },
        name: 'Tax'
      },
      {
        key: 'val-total',
        type: 'custom-total',
        parentKey: 'footer-totals',
        offset: { x: 0, y: 0 },
        size: { width: 280, height: 64 },
        name: 'Grand Total'
      }
    ],
    constraints: [],
  },
];

export const getPresetById = (id: string) => LAYOUT_PRESETS.find((preset) => preset.id === id);
