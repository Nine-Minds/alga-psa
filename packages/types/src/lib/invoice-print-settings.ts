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

export const CUSTOM_PAGE_SIZE_UNITS = ['in', 'mm'] as const;

export type CustomPageSizeUnit = (typeof CUSTOM_PAGE_SIZE_UNITS)[number];

/**
 * An explicit page size (labels, tags, odd stock). When set it replaces the preset's dimensions;
 * `paperPreset` stays on the settings as the fallback for consumers that only understand presets.
 */
export interface CustomPageSize {
  width: number;
  height: number;
  unit: CustomPageSizeUnit;
}

/** Bounds, in millimetres, for either side of a custom page. 10 mm covers the smallest roll labels. */
export const CUSTOM_PAGE_SIZE_MM_RANGE = {
  min: 10,
  max: 1200,
} as const;

export interface TemplatePrintSettings {
  paperPreset: InvoicePaperPresetId;
  marginMm: number;
  /** Optional and additive: absent means the preset's dimensions apply, exactly as before. */
  customPageSize?: CustomPageSize;
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
  /** Preset paper. Omitted for a custom page size, which is emitted as `width`/`height`. */
  format?: InvoicePaperPresetId;
  /** CSS length (e.g. `4in`), set only for a custom page size. */
  width?: string;
  /** CSS length (e.g. `2in`), set only for a custom page size. */
  height?: string;
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

export const customPageSizeToMm = (size: CustomPageSize): { widthMm: number; heightMm: number } => {
  const factor = size.unit === 'in' ? MM_PER_INCH : 1;
  return { widthMm: size.width * factor, heightMm: size.height * factor };
};

/** Returns a human-readable problem with `size`, or null when it is usable. */
export const validateCustomPageSize = (size: unknown): string | null => {
  if (typeof size !== 'object' || size === null) {
    return 'Custom page size must be an object with width, height and unit.';
  }
  const { width, height, unit } = size as Partial<CustomPageSize>;
  if (unit !== 'in' && unit !== 'mm') {
    return "Custom page size unit must be 'in' or 'mm'.";
  }
  if (typeof width !== 'number' || typeof height !== 'number' || !Number.isFinite(width) || !Number.isFinite(height)) {
    return 'Custom page size width and height must be numbers.';
  }
  const { widthMm, heightMm } = customPageSizeToMm({ width, height, unit });
  const { min, max } = CUSTOM_PAGE_SIZE_MM_RANGE;
  if (widthMm < min || heightMm < min || widthMm > max || heightMm > max) {
    return `Custom page size must be between ${min} mm and ${max} mm on each side.`;
  }
  return null;
};

const normalizeCustomPageSize = (size: unknown): CustomPageSize | null => {
  if (validateCustomPageSize(size) !== null) {
    return null;
  }
  const { width, height, unit } = size as CustomPageSize;
  return { width: roundToTwoDecimals(width), height: roundToTwoDecimals(height), unit };
};

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

  // An unusable custom size is dropped (the preset still applies) rather than failing the whole
  // settings object: this parses persisted data, and the designer reports the problem via
  // validateCustomPageSize at edit time.
  const customPageSize = normalizeCustomPageSize(value?.customPageSize);

  return {
    paperPreset: preset.id,
    marginMm: clampInvoiceMarginMm(marginMm),
    ...(customPageSize ? { customPageSize } : {}),
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
  const custom = settings.customPageSize ? customPageSizeToMm(settings.customPageSize) : null;
  const pageWidthPx = overrides?.pageWidthPx ?? (custom ? Math.round(millimetersToPixels(custom.widthMm)) : preset.widthPx);
  const pageHeightPx = overrides?.pageHeightPx ?? (custom ? Math.round(millimetersToPixels(custom.heightMm)) : preset.heightPx);

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
  const customPageSize = resolved.source === 'explicit' ? resolved.customPageSize : undefined;
  if (customPageSize) {
    // A custom page is sized by the document's own @page rule (see resolveCustomPageCss), which
    // also owns the margin; Chromium is told to honour it, and the same width/height is passed so
    // the two can never disagree. Margins are therefore not repeated here.
    return {
      width: `${customPageSize.width}${customPageSize.unit}`,
      height: `${customPageSize.height}${customPageSize.unit}`,
      margin: { top: '0mm', right: '0mm', bottom: '0mm', left: '0mm' },
      printBackground: true,
      preferCSSPageSize: true,
    };
  }

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

/**
 * The `@page` rule for a custom page size, or null for preset paper (whose output must not change).
 * Emitted into the rendered HTML so the browser print path and Puppeteer's `preferCSSPageSize`
 * agree on the page box and its margin.
 */
export const resolveCustomPageCss = (
  input: InvoicePrintResolutionInput | null | undefined
): string | null => {
  const resolved = resolveTemplatePrintSettings(input);
  const size = resolved.source === 'explicit' ? resolved.customPageSize : undefined;
  if (!size) {
    return null;
  }
  return `@page { size: ${size.width}${size.unit} ${size.height}${size.unit}; margin: ${roundToTwoDecimals(resolved.marginMm)}mm; }`;
};
