import {
  CUSTOM_PAGE_SIZE_MM_RANGE,
  INVOICE_PAPER_PRESET_REGISTRY,
  INVOICE_PAPER_PRESET_IDS,
  customPageSizeToMm,
  validateCustomPageSize,
  type CustomPageSize,
  type InvoicePaperPresetId,
  type InvoicePdfPrintOptions,
} from '@alga-psa/types';

/**
 * Batch layout: how N rendered label cells become pages of one PDF. Pure and client-safe.
 *
 *  - `one-per-page`: every label is its own page of exactly `pageSize` (thermal / roll printers).
 *  - `grid`: n-up on a sheet (Avery style). Cells are placed row-major, so record order reads
 *    left-to-right, top-to-bottom, continuing on the next sheet when a sheet fills up.
 *
 * Positions are absolute millimetres from the sheet's top-left corner, so what is printed does not
 * depend on the browser's flow layout.
 */

export type LabelLengthUnit = 'in' | 'mm';

export interface OnePerPageLayout {
  kind: 'one-per-page';
  pageSize: CustomPageSize;
}

export interface GridLayout {
  kind: 'grid';
  /** A preset sheet, or an explicit page size. */
  paper: InvoicePaperPresetId | CustomPageSize;
  columns: number;
  rows: number;
  /** All of the following are in `unit`. */
  unit: LabelLengthUnit;
  labelWidth: number;
  labelHeight: number;
  marginTop: number;
  marginLeft: number;
  gutterX: number;
  gutterY: number;
}

export type LabelBatchLayout = OnePerPageLayout | GridLayout;

export interface LabelCellPlacement {
  /** 0-based index into the input order. */
  index: number;
  sheet: number;
  column: number;
  row: number;
  leftMm: number;
  topMm: number;
  widthMm: number;
  heightMm: number;
}

export interface LabelBatchGeometry {
  pageWidthMm: number;
  pageHeightMm: number;
  sheets: number;
  placements: LabelCellPlacement[];
}

export class LabelLayoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LabelLayoutError';
  }
}

const EPSILON_MM = 0.01;
const toMm = (value: number, unit: LabelLengthUnit): number => (unit === 'in' ? value * 25.4 : value);

const requirePositiveInteger = (name: string, value: unknown): number => {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 100) {
    throw new LabelLayoutError(`${name} must be a whole number between 1 and 100.`);
  }
  return value;
};

const requireNonNegative = (name: string, value: unknown): number => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new LabelLayoutError(`${name} must be a number that is zero or more.`);
  }
  return value;
};

const requirePositive = (name: string, value: unknown): number => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new LabelLayoutError(`${name} must be a number greater than zero.`);
  }
  return value;
};

/** The sheet / page a layout prints on, in millimetres. */
export function resolveLayoutPageSizeMm(layout: LabelBatchLayout): { widthMm: number; heightMm: number } {
  if (layout.kind === 'one-per-page') {
    const problem = validateCustomPageSize(layout.pageSize);
    if (problem) throw new LabelLayoutError(problem);
    return customPageSizeToMm(layout.pageSize);
  }
  if (typeof layout.paper === 'string') {
    if (!(INVOICE_PAPER_PRESET_IDS as readonly string[]).includes(layout.paper)) {
      throw new LabelLayoutError(`Unknown paper "${String(layout.paper)}".`);
    }
    const preset = INVOICE_PAPER_PRESET_REGISTRY[layout.paper];
    return { widthMm: preset.widthMm, heightMm: preset.heightMm };
  }
  const problem = validateCustomPageSize(layout.paper);
  if (problem) throw new LabelLayoutError(problem);
  return customPageSizeToMm(layout.paper);
}

/** The size of one label cell, in millimetres. */
export function resolveCellSizeMm(layout: LabelBatchLayout): { widthMm: number; heightMm: number } {
  if (layout.kind === 'one-per-page') return resolveLayoutPageSizeMm(layout);
  return {
    widthMm: toMm(requirePositive('labelWidth', layout.labelWidth), layout.unit),
    heightMm: toMm(requirePositive('labelHeight', layout.labelHeight), layout.unit),
  };
}

/** Validates the layout (fail fast, never clip silently) and places `count` cells. */
export function planLabelBatch(layout: LabelBatchLayout, count: number): LabelBatchGeometry {
  if (!Number.isInteger(count) || count < 1) {
    throw new LabelLayoutError('A label batch needs at least one label.');
  }
  const { widthMm: pageWidthMm, heightMm: pageHeightMm } = resolveLayoutPageSizeMm(layout);

  if (layout.kind === 'one-per-page') {
    const placements = Array.from({ length: count }, (_, index) => ({
      index,
      sheet: index,
      column: 0,
      row: 0,
      leftMm: 0,
      topMm: 0,
      widthMm: pageWidthMm,
      heightMm: pageHeightMm,
    }));
    return { pageWidthMm, pageHeightMm, sheets: count, placements };
  }

  if (layout.unit !== 'in' && layout.unit !== 'mm') {
    throw new LabelLayoutError("Layout unit must be 'in' or 'mm'.");
  }
  const columns = requirePositiveInteger('columns', layout.columns);
  const rows = requirePositiveInteger('rows', layout.rows);
  const { widthMm: cellW, heightMm: cellH } = resolveCellSizeMm(layout);
  const marginTop = toMm(requireNonNegative('marginTop', layout.marginTop), layout.unit);
  const marginLeft = toMm(requireNonNegative('marginLeft', layout.marginLeft), layout.unit);
  const gutterX = toMm(requireNonNegative('gutterX', layout.gutterX), layout.unit);
  const gutterY = toMm(requireNonNegative('gutterY', layout.gutterY), layout.unit);

  const usedWidth = marginLeft + columns * cellW + (columns - 1) * gutterX;
  const usedHeight = marginTop + rows * cellH + (rows - 1) * gutterY;
  if (usedWidth > pageWidthMm + EPSILON_MM) {
    throw new LabelLayoutError(
      `The grid is ${usedWidth.toFixed(1)} mm wide but the paper is ${pageWidthMm.toFixed(1)} mm wide.`
    );
  }
  if (usedHeight > pageHeightMm + EPSILON_MM) {
    throw new LabelLayoutError(
      `The grid is ${usedHeight.toFixed(1)} mm tall but the paper is ${pageHeightMm.toFixed(1)} mm tall.`
    );
  }

  const perSheet = columns * rows;
  const placements: LabelCellPlacement[] = [];
  for (let index = 0; index < count; index += 1) {
    const slot = index % perSheet;
    const column = slot % columns;
    const row = Math.floor(slot / columns);
    placements.push({
      index,
      sheet: Math.floor(index / perSheet),
      column,
      row,
      leftMm: marginLeft + column * (cellW + gutterX),
      topMm: marginTop + row * (cellH + gutterY),
      widthMm: cellW,
      heightMm: cellH,
    });
  }
  return { pageWidthMm, pageHeightMm, sheets: Math.ceil(count / perSheet), placements };
}

/** CSS length for a millimetre value, stable to 3 decimals. */
export const mmCss = (mm: number): string => `${Math.round(mm * 1000) / 1000}mm`;

/**
 * Print options for a batch. The sheet size is always explicit (`width`/`height`) with
 * `preferCSSPageSize`, so a Letter sheet and a 4 x 2 in label page are both exact, and the margin
 * is zero because the layout owns every offset.
 */
export function resolveLabelBatchPdfOptions(geometry: LabelBatchGeometry): InvoicePdfPrintOptions {
  return {
    width: mmCss(geometry.pageWidthMm),
    height: mmCss(geometry.pageHeightMm),
    margin: { top: '0mm', right: '0mm', bottom: '0mm', left: '0mm' },
    printBackground: true,
    preferCSSPageSize: true,
  };
}

export const LABEL_SHEET_MIN_MM = CUSTOM_PAGE_SIZE_MM_RANGE.min;
