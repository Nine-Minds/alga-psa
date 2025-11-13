import { DesignerComponentType, DesignerConstraint, ConstraintStrength, Point, Size } from '../state/designerStore';

export interface LayoutPresetNodeDefinition {
  key: string;
  type: DesignerComponentType;
  offset: Point;
  size?: Size;
  name?: string;
  parentKey?: string;
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
      { key: 'section', type: 'section', offset: { x: 0, y: 0 }, size: { width: 640, height: 180 }, name: 'Header Section' },
      {
        key: 'column-left',
        type: 'column',
        parentKey: 'section',
        offset: { x: 0, y: 0 },
        size: { width: 260, height: 160 },
        name: 'Logo Column',
      },
      {
        key: 'column-right',
        type: 'column',
        parentKey: 'section',
        offset: { x: 260, y: 0 },
        size: { width: 320, height: 160 },
        name: 'Address Column',
      },
      {
        key: 'logo',
        type: 'logo',
        parentKey: 'column-left',
        offset: { x: 0, y: 0 },
        size: { width: 200, height: 120 },
        name: 'Logo',
      },
      {
        key: 'address',
        type: 'text',
        parentKey: 'column-right',
        offset: { x: 260, y: 0 },
        size: { width: 260, height: 140 },
        name: 'Billing Address',
      },
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
      { key: 'section', type: 'section', offset: { x: 0, y: 0 }, size: { width: 520, height: 320 }, name: 'Items Section' },
      {
        key: 'column',
        type: 'column',
        parentKey: 'section',
        offset: { x: 0, y: 0 },
        size: { width: 520, height: 320 },
        name: 'Items Column',
      },
      {
        key: 'table',
        type: 'table',
        parentKey: 'column',
        offset: { x: 0, y: 0 },
        size: { width: 520, height: 260 },
        name: 'Line Items',
      },
    ],
    constraints: [],
  },
  {
    id: 'totals-stack',
    label: 'Totals Stack',
    description: 'Totals summary with note block.',
    category: 'Footer',
    nodes: [
      { key: 'section', type: 'section', offset: { x: 0, y: 0 }, size: { width: 560, height: 200 }, name: 'Totals Section' },
      {
        key: 'column-note',
        type: 'column',
        parentKey: 'section',
        offset: { x: 0, y: 0 },
        size: { width: 260, height: 180 },
        name: 'Notes Column',
      },
      {
        key: 'column-totals',
        type: 'column',
        parentKey: 'section',
        offset: { x: 280, y: 0 },
        size: { width: 280, height: 180 },
        name: 'Totals Column',
      },
      {
        key: 'note',
        type: 'text',
        parentKey: 'column-note',
        offset: { x: 0, y: 20 },
        size: { width: 240, height: 80 },
        name: 'Notes',
      },
      {
        key: 'totals',
        type: 'totals',
        parentKey: 'column-totals',
        offset: { x: 280, y: 0 },
        size: { width: 280, height: 160 },
        name: 'Totals',
      },
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
      { key: 'section', type: 'section', offset: { x: 0, y: 0 }, size: { width: 560, height: 200 }, name: 'Summary Section' },
      {
        key: 'column-left',
        type: 'column',
        parentKey: 'section',
        offset: { x: 0, y: 0 },
        size: { width: 260, height: 180 },
        name: 'Summary Column',
      },
      {
        key: 'column-right',
        type: 'column',
        parentKey: 'section',
        offset: { x: 280, y: 0 },
        size: { width: 260, height: 180 },
        name: 'Contact Column',
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
        offset: { x: 280, y: 0 },
        size: { width: 240, height: 160 },
        name: 'Contact Info',
      },
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
      { key: 'section', type: 'section', offset: { x: 0, y: 0 }, size: { width: 640, height: 200 }, name: 'Split Header' },
      {
        key: 'column-logo',
        type: 'column',
        parentKey: 'section',
        offset: { x: 0, y: 0 },
        size: { width: 220, height: 180 },
        name: 'Logo Column',
      },
      {
        key: 'column-address',
        type: 'column',
        parentKey: 'section',
        offset: { x: 220, y: 0 },
        size: { width: 220, height: 180 },
        name: 'Address Column',
      },
      {
        key: 'column-qr',
        type: 'column',
        parentKey: 'section',
        offset: { x: 480, y: 0 },
        size: { width: 140, height: 180 },
        name: 'QR Column',
      },
      { key: 'logo', type: 'logo', parentKey: 'column-logo', offset: { x: 0, y: 0 }, size: { width: 200, height: 120 } },
      { key: 'address', type: 'text', parentKey: 'column-address', offset: { x: 220, y: 0 }, size: { width: 220, height: 140 } },
      { key: 'qr', type: 'qr', parentKey: 'column-qr', offset: { x: 480, y: 0 }, size: { width: 140, height: 140 } },
    ],
    constraints: [
      { type: 'align-top', nodes: ['logo', 'address'], strength: 'strong' },
      { type: 'align-top', nodes: ['address', 'qr'], strength: 'strong' },
      { type: 'aspect-ratio', node: 'qr', ratio: 1, strength: 'strong' },
    ],
  },
];

export const getPresetById = (id: string) => LAYOUT_PRESETS.find((preset) => preset.id === id);
