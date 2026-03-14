const MM_PER_INCH = 25.4;
const DESIGNER_DPI = 96;
const LEGACY_DEFAULT_MARGIN_PX = 40;
const DIMENSION_MATCH_TOLERANCE_PX = 3;

export const INVOICE_PAPER_PRESET_IDS = ['Letter', 'A4', 'Legal'] as const;

export type InvoicePaperPresetId = (typeof INVOICE_PAPER_PRESET_IDS)[number];

export interface InvoicePaperPresetDefinition {
  id: InvoicePaperPresetId;
  label: InvoicePaperPresetId;
  widthMm: number;
  heightMm: number;
  widthPx: number;
  heightPx: number;
}

export interface InvoiceTemplatePrintSettings {
  paperPreset: InvoicePaperPresetId;
  marginMm: number;
}

export interface InvoicePrintResolutionInput {
  printSettings?: Partial<InvoiceTemplatePrintSettings> | null;
  pageWidthPx?: number | null;
  pageHeightPx?: number | null;
  documentWidthPx?: number | null;
  documentHeightPx?: number | null;
  pagePaddingPx?: number | null;
}

export interface ResolvedInvoiceTemplatePrintSettings extends InvoiceTemplatePrintSettings {
  source: 'explicit' | 'inferred' | 'fallback';
  preset: InvoicePaperPresetDefinition;
  pageWidthPx: number;
  pageHeightPx: number;
  marginPx: number;
  printableWidthPx: number;
  printableHeightPx: number;
}

export interface InvoicePdfPrintOptions {
  format: InvoicePaperPresetId;
  margin: {
    top: string;
    right: string;
    bottom: string;
    left: string;
  };
  printBackground: true;
}

export const INVOICE_PRINT_MARGIN_MM_RANGE = {
  min: 0,
  max: 50,
} as const;

const roundToTwoDecimals = (value: number): number => Math.round(value * 100) / 100;

export const millimetersToPixels = (millimeters: number): number =>
  (millimeters / MM_PER_INCH) * DESIGNER_DPI;

export const pixelsToMillimeters = (pixels: number): number =>
  (pixels / DESIGNER_DPI) * MM_PER_INCH;

const createPaperPreset = (
  id: InvoicePaperPresetId,
  widthMm: number,
  heightMm: number
): InvoicePaperPresetDefinition => ({
  id,
  label: id,
  widthMm,
  heightMm,
  widthPx: Math.round(millimetersToPixels(widthMm)),
  heightPx: Math.round(millimetersToPixels(heightMm)),
});

export const INVOICE_PAPER_PRESET_REGISTRY: Record<InvoicePaperPresetId, InvoicePaperPresetDefinition> = {
  Letter: createPaperPreset('Letter', 215.9, 279.4),
  A4: createPaperPreset('A4', 210, 297),
  Legal: createPaperPreset('Legal', 215.9, 355.6),
};

export const DEFAULT_INVOICE_PRINT_SETTINGS: InvoiceTemplatePrintSettings = {
  paperPreset: 'Letter',
  marginMm: roundToTwoDecimals(pixelsToMillimeters(LEGACY_DEFAULT_MARGIN_PX)),
};

export const listInvoicePaperPresets = (): InvoicePaperPresetDefinition[] =>
  INVOICE_PAPER_PRESET_IDS.map((presetId) => INVOICE_PAPER_PRESET_REGISTRY[presetId]);

export const getInvoicePaperPresetById = (
  presetId: string | null | undefined
): InvoicePaperPresetDefinition | null => {
  if (!presetId || !Object.prototype.hasOwnProperty.call(INVOICE_PAPER_PRESET_REGISTRY, presetId)) {
    return null;
  }

  return INVOICE_PAPER_PRESET_REGISTRY[presetId as InvoicePaperPresetId];
};

export const clampInvoiceMarginMm = (marginMm: number): number => {
  if (!Number.isFinite(marginMm)) {
    return DEFAULT_INVOICE_PRINT_SETTINGS.marginMm;
  }

  return roundToTwoDecimals(
    Math.min(
      Math.max(marginMm, INVOICE_PRINT_MARGIN_MM_RANGE.min),
      INVOICE_PRINT_MARGIN_MM_RANGE.max
    )
  );
};

export const normalizeInvoiceTemplatePrintSettings = (
  value: Partial<InvoiceTemplatePrintSettings> | null | undefined
): InvoiceTemplatePrintSettings | null => {
  const preset = getInvoicePaperPresetById(
    typeof value?.paperPreset === 'string' ? value.paperPreset : null
  );
  const marginMm = typeof value?.marginMm === 'number' ? value.marginMm : null;

  if (!preset || marginMm === null || !Number.isFinite(marginMm)) {
    return null;
  }

  return {
    paperPreset: preset.id,
    marginMm: clampInvoiceMarginMm(marginMm),
  };
};

export const resolveInvoicePaperPresetFromDimensions = (
  widthPx: number | null | undefined,
  heightPx: number | null | undefined,
  tolerancePx: number = DIMENSION_MATCH_TOLERANCE_PX
): InvoicePaperPresetDefinition | null => {
  if (!Number.isFinite(widthPx) || !Number.isFinite(heightPx)) {
    return null;
  }

  return (
    listInvoicePaperPresets().find(
      (preset) =>
        Math.abs(preset.widthPx - widthPx) <= tolerancePx &&
        Math.abs(preset.heightPx - heightPx) <= tolerancePx
    ) ?? null
  );
};

const createResolvedInvoiceTemplatePrintSettings = (
  settings: InvoiceTemplatePrintSettings,
  source: ResolvedInvoiceTemplatePrintSettings['source']
): ResolvedInvoiceTemplatePrintSettings => {
  const preset = INVOICE_PAPER_PRESET_REGISTRY[settings.paperPreset];
  const marginPx = Math.round(millimetersToPixels(settings.marginMm));

  return {
    ...settings,
    source,
    preset,
    pageWidthPx: preset.widthPx,
    pageHeightPx: preset.heightPx,
    marginPx,
    printableWidthPx: Math.max(1, preset.widthPx - marginPx * 2),
    printableHeightPx: Math.max(1, preset.heightPx - marginPx * 2),
  };
};

export const resolveInvoiceTemplatePrintSettings = (
  input: InvoicePrintResolutionInput | null | undefined
): ResolvedInvoiceTemplatePrintSettings => {
  const explicitSettings = normalizeInvoiceTemplatePrintSettings(input?.printSettings);
  if (explicitSettings) {
    return createResolvedInvoiceTemplatePrintSettings(explicitSettings, 'explicit');
  }

  const inferredPreset =
    resolveInvoicePaperPresetFromDimensions(input?.pageWidthPx, input?.pageHeightPx) ??
    resolveInvoicePaperPresetFromDimensions(input?.documentWidthPx, input?.documentHeightPx);

  if (inferredPreset) {
    const inferredMarginMm = clampInvoiceMarginMm(
      Number.isFinite(input?.pagePaddingPx) ? pixelsToMillimeters(input?.pagePaddingPx ?? 0) : DEFAULT_INVOICE_PRINT_SETTINGS.marginMm
    );

    return createResolvedInvoiceTemplatePrintSettings(
      {
        paperPreset: inferredPreset.id,
        marginMm: inferredMarginMm,
      },
      'inferred'
    );
  }

  return createResolvedInvoiceTemplatePrintSettings(DEFAULT_INVOICE_PRINT_SETTINGS, 'fallback');
};

export const resolveInvoicePdfPrintOptions = (
  input: InvoicePrintResolutionInput | null | undefined
): InvoicePdfPrintOptions => {
  const resolved = resolveInvoiceTemplatePrintSettings(input);
  const margin = `${resolved.marginMm}mm`;

  return {
    format: resolved.paperPreset,
    margin: {
      top: margin,
      right: margin,
      bottom: margin,
      left: margin,
    },
    printBackground: true,
  };
};
