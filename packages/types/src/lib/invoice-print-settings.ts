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

export interface TemplatePrintSettings {
  paperPreset: InvoicePaperPresetId;
  marginMm: number;
}

export interface InvoicePrintResolutionInput {
  printSettings?: Partial<TemplatePrintSettings> | null;
  pageWidthPx?: number | null;
  pageHeightPx?: number | null;
  documentWidthPx?: number | null;
  documentHeightPx?: number | null;
  pagePaddingPx?: number | null;
}

export interface ResolvedTemplatePrintSettings extends TemplatePrintSettings {
  source: 'explicit' | 'inferred' | 'fallback' | 'legacy-unresolved';
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
  preferCSSPageSize?: boolean;
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

export const DEFAULT_INVOICE_PRINT_SETTINGS: TemplatePrintSettings = {
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

export const normalizeTemplatePrintSettings = (
  value: Partial<TemplatePrintSettings> | null | undefined
): TemplatePrintSettings | null => {
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

  const resolvedWidthPx = Number(widthPx);
  const resolvedHeightPx = Number(heightPx);

  return (
    listInvoicePaperPresets().find(
      (preset) =>
        Math.abs(preset.widthPx - resolvedWidthPx) <= tolerancePx &&
        Math.abs(preset.heightPx - resolvedHeightPx) <= tolerancePx
    ) ?? null
  );
};

const createResolvedTemplatePrintSettings = (
  settings: TemplatePrintSettings,
  source: ResolvedTemplatePrintSettings['source'],
  overrides?: Partial<Pick<ResolvedTemplatePrintSettings, 'pageWidthPx' | 'pageHeightPx' | 'marginPx'>>
): ResolvedTemplatePrintSettings => {
  const preset = INVOICE_PAPER_PRESET_REGISTRY[settings.paperPreset];
  const marginPx = overrides?.marginPx ?? Math.round(millimetersToPixels(settings.marginMm));
  const pageWidthPx = overrides?.pageWidthPx ?? preset.widthPx;
  const pageHeightPx = overrides?.pageHeightPx ?? preset.heightPx;

  return {
    ...settings,
    source,
    preset,
    pageWidthPx,
    pageHeightPx,
    marginPx,
    printableWidthPx: Math.max(1, pageWidthPx - marginPx * 2),
    printableHeightPx: Math.max(1, pageHeightPx - marginPx * 2),
  };
};

export const resolveTemplatePrintSettings = (
  input: InvoicePrintResolutionInput | null | undefined
): ResolvedTemplatePrintSettings => {
  const explicitSettings = normalizeTemplatePrintSettings(input?.printSettings);
  if (explicitSettings) {
    return createResolvedTemplatePrintSettings(explicitSettings, 'explicit');
  }

  const inferredPreset =
    resolveInvoicePaperPresetFromDimensions(input?.pageWidthPx, input?.pageHeightPx) ??
    resolveInvoicePaperPresetFromDimensions(input?.documentWidthPx, input?.documentHeightPx);

  if (inferredPreset) {
    const inferredMarginMm = clampInvoiceMarginMm(
      Number.isFinite(input?.pagePaddingPx) ? pixelsToMillimeters(input?.pagePaddingPx ?? 0) : DEFAULT_INVOICE_PRINT_SETTINGS.marginMm
    );

    return createResolvedTemplatePrintSettings(
      {
        paperPreset: inferredPreset.id,
        marginMm: inferredMarginMm,
      },
      'inferred'
    );
  }

  const legacyWidthPx = input?.pageWidthPx ?? input?.documentWidthPx;
  const legacyHeightPx = input?.pageHeightPx ?? input?.documentHeightPx;
  if (Number.isFinite(legacyWidthPx) && Number.isFinite(legacyHeightPx)) {
    const resolvedLegacyWidthPx = Number(legacyWidthPx);
    const resolvedLegacyHeightPx = Number(legacyHeightPx);
    const legacyMarginMm = clampInvoiceMarginMm(
      Number.isFinite(input?.pagePaddingPx)
        ? pixelsToMillimeters(input?.pagePaddingPx ?? 0)
        : DEFAULT_INVOICE_PRINT_SETTINGS.marginMm
    );

    return createResolvedTemplatePrintSettings(
      {
        paperPreset: DEFAULT_INVOICE_PRINT_SETTINGS.paperPreset,
        marginMm: legacyMarginMm,
      },
      'legacy-unresolved',
      {
        pageWidthPx: Math.max(1, Math.round(resolvedLegacyWidthPx)),
        pageHeightPx: Math.max(1, Math.round(resolvedLegacyHeightPx)),
        marginPx: Number.isFinite(input?.pagePaddingPx) ? Math.max(0, Math.round(input?.pagePaddingPx ?? 0)) : undefined,
      }
    );
  }

  return createResolvedTemplatePrintSettings(DEFAULT_INVOICE_PRINT_SETTINGS, 'fallback');
};

export const resolveInvoicePdfPrintOptions = (
  input: InvoicePrintResolutionInput | null | undefined
): InvoicePdfPrintOptions => {
  const resolved = resolveTemplatePrintSettings(input);

  // When margins come from explicit printSettings (not inferred from CSS
  // padding), use them as Puppeteer margins.  When they were inferred from the
  // page section's CSS padding, the padding is already in the HTML — setting
  // Puppeteer margins too would double-count and push content to extra pages.
  const hasCssPadding = Number.isFinite(input?.pagePaddingPx) && (input?.pagePaddingPx ?? 0) > 0;
  const useExplicitMargin = resolved.source === 'explicit' && !hasCssPadding;
  const marginStr = useExplicitMargin ? `${roundToTwoDecimals(resolved.marginMm)}mm` : '0mm';

  return {
    format: resolved.paperPreset,
    margin: {
      top: marginStr,
      right: marginStr,
      bottom: marginStr,
      left: marginStr,
    },
    printBackground: true,
  };
};
