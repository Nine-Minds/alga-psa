import type { DesignerComponentType, DesignerContainerLayout, DesignerNodeStyle, Point, Size } from '../state/designerStore';

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
  id: string;
  label: string;
  description: string;
  category: 'Header' | 'Body' | 'Footer';
  nodes: LayoutPresetNodeDefinition[];
  constraints?: LayoutPresetConstraintDefinition[];
}

export const LAYOUT_PRESETS: LayoutPresetDefinition[] = [
  {
    id: 'header-logo-address',
    label: 'Header: Logo + Address',
    description: 'Two-column header with locked logo ratio and address stack.',
    category: 'Header',
    nodes: [
      { 
        key: 'section', 
        type: 'section', 
        offset: { x: 0, y: 0 }, 
        size: { width: 640, height: 180 }, 
        name: 'Header Section',
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
        size: { width: 260, height: 160 },
        name: 'Logo Column',
        layout: {
          display: 'flex',
          flexDirection: 'column',
          gap: '10px',
          padding: '0px',
          justifyContent: 'flex-start',
          alignItems: 'flex-start',
        }
      },
      {
        key: 'column-right',
        type: 'container',
        parentKey: 'section',
        offset: { x: 0, y: 0 },
        size: { width: 320, height: 160 },
        name: 'Address Column',
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
        key: 'logo',
        type: 'logo',
        parentKey: 'column-left',
        offset: { x: 0, y: 0 },
        size: { width: 200, height: 120 },
        name: 'Logo',
        style: {
          aspectRatio: '3 / 2',
          objectFit: 'contain',
        },
      },
      {
        key: 'address',
        type: 'text',
        parentKey: 'column-right',
        offset: { x: 0, y: 0 },
        size: { width: 260, height: 140 },
        name: 'Billing Address',
      },
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
