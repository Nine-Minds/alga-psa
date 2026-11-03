import {
  CUSTOM_PAGE_SIZE_MM_RANGE,
  INVOICE_PAPER_PRESET_REGISTRY,
  INVOICE_PAPER_PRESET_IDS,
  customPageSizeToMm,
  validateCustomPageSize,
  type CustomPageSize,
  type InvoicePaperPresetId,
  type InvoicePdfPrintOptions,
  type LabelPrintErrorCode,
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
  readonly errorCode?: LabelPrintErrorCode;
  readonly worksheetNumbers?: number[];
  constructor(message: string, details?: { errorCode: LabelPrintErrorCode; worksheetNumbers?: number[] }) {
    super(message);
    this.name = 'LabelLayoutError';
    this.errorCode = details?.errorCode;
    this.worksheetNumbers = details?.worksheetNumbers;
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

/**
 * Page size range a template may ask the printer for on its own (the print dialog's "template paper"
 * default). Wider than the schema's absolute bounds (10 - 1200 mm) on the small end because a page
 * below ~60 mm is a die-cut tag, not paper a normal printer holds, and belongs on the roll layout.
 */
export const LABEL_TEMPLATE_FIT_PAGE_MM_RANGE = { min: 60, max: 1200 } as const;

type LabelTemplatePageMetadata = {
  labelSettings?: { worksheetMode?: 'letter' };
  printSettings?: { customPageSize?: CustomPageSize; paperPreset?: InvoicePaperPresetId };
};

/** Worksheet details require a portrait Letter-size or larger design, even for custom templates. */
export function resolveWorksheetDesignSizeMm(
  metadata?: LabelTemplatePageMetadata | null
): { widthMm: number; heightMm: number } | null {
  if (metadata?.labelSettings?.worksheetMode !== 'letter') return null;
  const settings = metadata.printSettings;
  let size: { widthMm: number; heightMm: number };
  if (settings?.customPageSize) {
    const problem = validateCustomPageSize(settings.customPageSize);
    if (problem) throw new LabelLayoutError(problem, { errorCode: 'worksheetPageSize' });
    size = customPageSizeToMm(settings.customPageSize);
  } else {
    const preset = settings?.paperPreset && INVOICE_PAPER_PRESET_REGISTRY[settings.paperPreset];
    if (!preset) {
      throw new LabelLayoutError('A Letter worksheet must specify Letter or a larger portrait page size in the designer.', {
        errorCode: 'worksheetPageSize',
      });
    }
    size = { widthMm: preset.widthMm, heightMm: preset.heightMm };
  }
  const letter = INVOICE_PAPER_PRESET_REGISTRY.Letter;
  if (
    size.widthMm >= size.heightMm ||
    size.widthMm + 0.05 < letter.widthMm ||
    size.heightMm + 0.05 < letter.heightMm
  ) {
    throw new LabelLayoutError('A Letter worksheet must be designed for Letter or a larger portrait page size.', {
      errorCode: 'worksheetPageSize',
    });
  }
  return size;
}

/** True when a template's own page size is paper an ordinary printer holds (a worksheet, not a tag). */
export function labelMetadataPrefersPaperPage(
  metadata?: LabelTemplatePageMetadata | null
): boolean {
  const pageSize = metadata?.printSettings?.customPageSize;
  const preset = metadata?.labelSettings?.worksheetMode === 'letter' && metadata.printSettings?.paperPreset
    ? INVOICE_PAPER_PRESET_REGISTRY[metadata.printSettings.paperPreset]
    : null;
  if (pageSize && validateCustomPageSize(pageSize)) return false;
  const size = pageSize ? customPageSizeToMm(pageSize) : preset;
  if (!size) return false;
  const { widthMm, heightMm } = size;
  const { min, max } = LABEL_TEMPLATE_FIT_PAGE_MM_RANGE;
  return widthMm >= min && widthMm <= max && heightMm >= min && heightMm <= max;
}

/**
 * The page size every template in the batch asks for, when they all agree on one explicit
 * `customPageSize` (one label per page) that ordinary paper can hold. Returns null otherwise, which
 * keeps the caller's default layout. This is what lets a Letter worksheet template print on Letter
 * without the caller having to pick the paper twice.
 */
export function resolveTemplatePreferredPageSizes(
  templates: readonly { metadata?: LabelTemplatePageMetadata | undefined }[]
): CustomPageSize | null {
  if (templates.length === 0) return null;
  let preferred: CustomPageSize | null = null;
  for (const template of templates) {
    const worksheetSize = resolveWorksheetDesignSizeMm(template.metadata);
    const pageSize = template.metadata?.printSettings?.customPageSize ??
      (worksheetSize ? { width: worksheetSize.widthMm, height: worksheetSize.heightMm, unit: 'mm' as const } : undefined);
    if (!pageSize || !labelMetadataPrefersPaperPage(template.metadata)) return null;
    if (preferred === null) {
      preferred = pageSize;
    } else {
      const a = customPageSizeToMm(preferred);
      const b = customPageSizeToMm(pageSize);
      if (Math.abs(a.widthMm - b.widthMm) > EPSILON_MM || Math.abs(a.heightMm - b.heightMm) > EPSILON_MM) return null;
    }
  }
  return preferred;
}
