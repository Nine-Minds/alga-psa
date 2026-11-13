/** Layout presets for the label print dialog, in the shape POST /api/labels/pdf accepts as `layout`. */
export type LabelLayoutPresetId = 'template-preferred' | 'roll-4x2' | 'letter-2x5' | 'a4-2x7' | 'letter-full' | 'a4-full';

export const LABEL_LAYOUT_STORAGE_KEY = 'alga.labels.layout';
export const DEFAULT_LABEL_LAYOUT_PRESET: LabelLayoutPresetId = 'template-preferred';

export const LABEL_LAYOUT_PRESETS: Record<LabelLayoutPresetId, { defaultLabel: string; layout: unknown | null }> = {
  // `null` sends no layout at all: the server prints on the page size the template itself declares
  // (an A4 or Letter worksheet), falling back to the 4 x 2 in roll when the templates do not agree on one.
  'template-preferred': {
    defaultLabel: 'Template paper (default)',
    layout: null,
  },
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
  'letter-full': {
    defaultLabel: 'Letter sheet, one per page',
    layout: { kind: 'one-per-page', pageSize: { width: 8.5, height: 11, unit: 'in' } },
  },
  'a4-full': {
    defaultLabel: 'A4 sheet, one per page',
    layout: { kind: 'one-per-page', pageSize: { width: 210, height: 297, unit: 'mm' } },
  },
};

export function isLabelLayoutPresetId(value: unknown): value is LabelLayoutPresetId {
  return typeof value === 'string' && value in LABEL_LAYOUT_PRESETS;
}
