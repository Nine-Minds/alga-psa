/** Layout presets for the label print dialog, in the shape POST /api/labels/pdf accepts as `layout`. */
export type LabelLayoutPresetId = 'roll-4x2' | 'letter-2x5' | 'a4-2x7';

export const LABEL_LAYOUT_STORAGE_KEY = 'alga.labels.layout';
export const DEFAULT_LABEL_LAYOUT_PRESET: LabelLayoutPresetId = 'roll-4x2';

export const LABEL_LAYOUT_PRESETS: Record<LabelLayoutPresetId, { defaultLabel: string; layout: unknown }> = {
  'roll-4x2': {
    defaultLabel: 'One per label (4 × 2 in roll)',
    layout: { kind: 'one-per-page', pageSize: { width: 4, height: 2, unit: 'in' } },
  },
  'letter-2x5': {
    defaultLabel: 'Letter sheet, 2 × 5 (Avery 5163-style)',
    layout: {
      kind: 'grid', paper: 'Letter', columns: 2, rows: 5, unit: 'in',
      labelWidth: 4, labelHeight: 2, marginTop: 0.5, marginLeft: 0.1875, gutterX: 0.125, gutterY: 0,
    },
  },
  'a4-2x7': {
    defaultLabel: 'A4 sheet, 2 × 7 (99.1 × 38.1 mm style)',
    layout: {
      kind: 'grid', paper: 'A4', columns: 2, rows: 7, unit: 'mm',
      labelWidth: 99.1, labelHeight: 38.1, marginTop: 15.15, marginLeft: 4.65, gutterX: 2.5, gutterY: 0,
    },
  },
};

export function isLabelLayoutPresetId(value: unknown): value is LabelLayoutPresetId {
  return typeof value === 'string' && value in LABEL_LAYOUT_PRESETS;
}
