import { DesignerComponentType, DesignerConstraint, ConstraintStrength, Point, Size } from '../state/designerStore';

export interface LayoutPresetNodeDefinition {
  key: string;
  type: DesignerComponentType;
  offset: Point;
  size?: Size;
  name?: string;
}

export type LayoutPresetConstraintDefinition =
  | {
      type: 'align-left' | 'align-top' | 'match-width' | 'match-height';
      nodes: [string, string];
      strength?: ConstraintStrength;
    }
  | {
      type: 'aspect-ratio';
      node: string;
      ratio: number;
      strength?: ConstraintStrength;
    };

export interface LayoutPresetDefinition {
  id: string;
  label: string;
  description: string;
  category: 'Header' | 'Body' | 'Footer';
  nodes: LayoutPresetNodeDefinition[];
  constraints: LayoutPresetConstraintDefinition[];
}

export const LAYOUT_PRESETS: LayoutPresetDefinition[] = [
  {
    id: 'header-logo-address',
    label: 'Header: Logo + Address',
    description: 'Two-column header with locked logo ratio and address stack.',
    category: 'Header',
    nodes: [
      { key: 'logo', type: 'logo', offset: { x: 0, y: 0 }, size: { width: 200, height: 120 }, name: 'Logo' },
      { key: 'address', type: 'text', offset: { x: 260, y: 0 }, size: { width: 260, height: 140 }, name: 'Billing Address' },
    ],
    constraints: [
      { type: 'align-top', nodes: ['logo', 'address'], strength: 'strong' },
      { type: 'match-height', nodes: ['logo', 'address'], strength: 'medium' },
      { type: 'aspect-ratio', node: 'logo', ratio: 1.5, strength: 'strong' },
    ],
  },
  {
    id: 'line-items-table',
    label: 'Line Items Table',
    description: 'Full-width items table with repeating rows.',
    category: 'Body',
    nodes: [
      { key: 'table', type: 'table', offset: { x: 0, y: 0 }, size: { width: 520, height: 260 }, name: 'Line Items' },
    ],
    constraints: [],
  },
  {
    id: 'totals-stack',
    label: 'Totals Stack',
    description: 'Totals summary with note block.',
    category: 'Footer',
    nodes: [
      { key: 'totals', type: 'totals', offset: { x: 280, y: 0 }, size: { width: 280, height: 160 }, name: 'Totals' },
      { key: 'note', type: 'text', offset: { x: 0, y: 20 }, size: { width: 240, height: 80 }, name: 'Notes' },
    ],
    constraints: [
      { type: 'align-top', nodes: ['totals', 'note'], strength: 'weak' },
    ],
  },
  {
    id: 'two-column-summary',
    label: 'Two-Column Summary',
    description: 'Equal columns for summary and contact info.',
    category: 'Body',
    nodes: [
      { key: 'summary', type: 'text', offset: { x: 0, y: 0 }, size: { width: 240, height: 160 }, name: 'Summary' },
      { key: 'contact', type: 'text', offset: { x: 280, y: 0 }, size: { width: 240, height: 160 }, name: 'Contact Info' },
    ],
    constraints: [
      { type: 'match-width', nodes: ['summary', 'contact'], strength: 'required' },
      { type: 'align-top', nodes: ['summary', 'contact'], strength: 'strong' },
    ],
  },
  {
    id: 'header-with-qr',
    label: 'Split Header with QR',
    description: 'Logo + address stack with QR code payment block.',
    category: 'Header',
    nodes: [
      { key: 'logo', type: 'logo', offset: { x: 0, y: 0 }, size: { width: 200, height: 120 } },
      { key: 'address', type: 'text', offset: { x: 220, y: 0 }, size: { width: 220, height: 140 } },
      { key: 'qr', type: 'qr', offset: { x: 480, y: 0 }, size: { width: 140, height: 140 } },
    ],
    constraints: [
      { type: 'align-top', nodes: ['logo', 'address'], strength: 'strong' },
      { type: 'align-top', nodes: ['address', 'qr'], strength: 'strong' },
      { type: 'aspect-ratio', node: 'qr', ratio: 1, strength: 'strong' },
    ],
  },
];

export const getPresetById = (id: string) => LAYOUT_PRESETS.find((preset) => preset.id === id);
