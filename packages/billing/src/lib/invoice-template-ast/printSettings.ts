import {
  customPageSizeToMm,
  resolveCustomPageCss,
  resolveInvoicePdfPrintOptions,
  resolveTemplatePrintSettings,
  type InvoicePdfPrintOptions,
  type InvoicePrintResolutionInput,
  type TemplateAst,
  type ResolvedTemplatePrintSettings,
} from '@alga-psa/types';

type UnknownRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is UnknownRecord =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const parsePxLength = (value: unknown): number | undefined => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed.length) {
      return undefined;
    }
    const numeric = Number.parseFloat(trimmed.replace(/px$/i, '').trim());
    return Number.isFinite(numeric) ? numeric : undefined;
  }
  return undefined;
};

const getDocumentInlineStyle = (ast: TemplateAst | null | undefined): UnknownRecord | undefined =>
  isRecord(ast?.layout?.style?.inline) ? (ast.layout.style.inline as UnknownRecord) : undefined;

const getPageSectionInlineStyle = (ast: TemplateAst | null | undefined): UnknownRecord | undefined => {
  const documentChildren = ast?.layout?.children ?? [];
  const pageSectionCandidate =
    documentChildren.length === 1 && documentChildren[0]?.type === 'section' ? documentChildren[0] : null;

  return isRecord(pageSectionCandidate?.style?.inline) ? (pageSectionCandidate.style.inline as UnknownRecord) : undefined;
};

export const resolvePrintResolutionInputFromAst = (
  ast: TemplateAst | null | undefined
): InvoicePrintResolutionInput => {
  const documentInline = getDocumentInlineStyle(ast);
  const pageSectionInline = getPageSectionInlineStyle(ast);

  return {
    printSettings: ast?.metadata?.printSettings,
    documentWidthPx: parsePxLength(documentInline?.width),
    documentHeightPx: parsePxLength(documentInline?.height),
    pageWidthPx: parsePxLength(pageSectionInline?.width),
    pageHeightPx: parsePxLength(pageSectionInline?.height),
    pagePaddingPx: parsePxLength(pageSectionInline?.padding),
  };
};

export const resolveTemplatePrintSettingsFromAst = (
  ast: TemplateAst | null | undefined
): ResolvedTemplatePrintSettings =>
  resolveTemplatePrintSettings(resolvePrintResolutionInputFromAst(ast));

export const resolvePdfPrintOptionsFromAst = (
  ast: TemplateAst | null | undefined
): InvoicePdfPrintOptions => resolveInvoicePdfPrintOptions(resolvePrintResolutionInputFromAst(ast));


/** The `@page` rule for a custom page size, or null for preset paper. */
export const resolveCustomPageCssFromAst = (ast: TemplateAst | null | undefined): string | null =>
  resolveCustomPageCss(resolvePrintResolutionInputFromAst(ast));

/**
 * The numbers one document prints by, in millimetres: the sheet, the margin the page box carries
 * on every page, and the content box left over. Nothing else in the pipeline may add a margin or
 * pin a width — the page box owns the first and `DOCUMENT_PRINT_GEOMETRY_CSS` strips the second.
 */
export interface DocumentPrintGeometry {
  pageWidthMm: number;
  pageHeightMm: number;
  marginMm: number;
  contentWidthMm: number;
  contentHeightMm: number;
}

const roundToTwoDecimals = (value: number): number => Math.round(value * 100) / 100;

const pxToMm = (px: number): number => (px * 25.4) / 96;

export const resolveDocumentPrintGeometryFromAst = (
  ast: TemplateAst | null | undefined
): DocumentPrintGeometry => {
  const resolved = resolveTemplatePrintSettingsFromAst(ast);
  const custom = resolved.source === 'explicit' ? resolved.customPageSize : undefined;
  const page = custom
    ? customPageSizeToMm(custom)
    : resolved.source === 'legacy-unresolved'
      ? { widthMm: pxToMm(resolved.pageWidthPx), heightMm: pxToMm(resolved.pageHeightPx) }
      : { widthMm: resolved.preset.widthMm, heightMm: resolved.preset.heightMm };
  // The same number resolveInvoicePdfPrintOptions puts in the Puppeteer margin and
  // resolveCustomPageCss puts in the @page rule, so all three agree by construction.
  const marginMm = roundToTwoDecimals(resolved.marginMm);
  return {
    pageWidthMm: roundToTwoDecimals(page.widthMm),
    pageHeightMm: roundToTwoDecimals(page.heightMm),
    marginMm,
    contentWidthMm: roundToTwoDecimals(page.widthMm - marginMm * 2),
    contentHeightMm: roundToTwoDecimals(page.heightMm - marginMm * 2),
  };
};

/**
 * Print geometry for a `document`: the page box carries the margin (resolveInvoicePdfPrintOptions
 * for preset paper, the @page rule for a custom size), so the markup must carry none of its own.
 *
 * Three things in the markup would otherwise fight it. The browser's default body margin adds
 * ~2 mm; the renderer pads the document root by the template margin, which only indents the first
 * page (a box's padding cannot repeat per page, which is why later pages used to start higher than
 * the first); and a designer-saved template pins that root to the full page WIDTH — the sheet the
 * canvas draws — which overflows the printable area and made Chromium shrink every page to fit,
 * printing the whole document a tenth smaller than it was authored. Stripped for print, the root
 * takes exactly the content box the page box leaves.
 *
 * Screen is untouched: the preview still shows the page-sized root with its margin.
 *
 * Never emitted for a label (`label-cell` geometry): there the renderer's root padding IS the
 * margin, because composeLabelSheets gives the cell no padding of its own.
 */
export const DOCUMENT_PRINT_GEOMETRY_RULES = `
  html, body { margin: 0; padding: 0; }
  .invoice-template-root > .ast-node-type-document {
    width: auto !important;
    min-width: 0 !important;
    max-width: none !important;
    height: auto !important;
    min-height: 0 !important;
    margin: 0 !important;
    padding: 0 !important;
  }
  /* A template authored before the designer wraps its page in a single section that carries the
     margin as padding — the same padding resolvePrintResolutionInputFromAst reads the margin from. */
  .invoice-template-root > .ast-node-type-document > section.ast-node-type-section:only-child {
    width: auto !important;
    height: auto !important;
    margin: 0 !important;
    padding: 0 !important;
  }
`;

export const DOCUMENT_PRINT_GEOMETRY_CSS = `@media print {${DOCUMENT_PRINT_GEOMETRY_RULES}}`;

/**
 * How a document type reaches paper, which decides what frames its content:
 * - `document`: the single-document PDF path (pdfGenerationService). Content flows across pages.
 * - `label-cell`: the label batch path (composeLabelSheets). The template becomes one fixed-size cell with
 *   no outer margin (the renderer's root padding carries the margin) and anything past the cell is clipped.
 */
export type TemplatePrintGeometry = 'document' | 'label-cell';

/** The sheet the authoritative preview draws a label on, in millimetres. */
export interface TemplatePreviewSheet {
  widthMm: number;
  heightMm: number;
  /** Where the renderer pads the root (the template margin), drawn as the printable-area guide. */
  guideMarginMm: number;
}

/**
 * The sheet the authoritative preview draws `ast` on — always a real sheet, because both print paths
 * now have an exact geometry to match.
 *
 * A `document` takes resolveDocumentPrintGeometryFromAst: the page box the PDF prints onto and the
 * margin it carries on every page, so the sheet and the PDF read the same numbers out of one place.
 * A document flows across many sheets; previewPagination.server draws one of these per printed page.
 *
 * A `label-cell` takes the template's own page settings: one clipped cell with no outer margin, where
 * the renderer's root padding is the margin, so the sheet is the label.
 */
export const resolveTemplatePreviewSheetFromAst = (
  ast: TemplateAst | null | undefined,
  geometry: TemplatePrintGeometry
): TemplatePreviewSheet | null => {
  if (geometry !== 'label-cell') {
    const page = resolveDocumentPrintGeometryFromAst(ast);
    return { widthMm: page.pageWidthMm, heightMm: page.pageHeightMm, guideMarginMm: page.marginMm };
  }
  const resolved = resolveTemplatePrintSettingsFromAst(ast);
  const custom = resolved.source === 'explicit' ? resolved.customPageSize : undefined;
  const size = custom
    ? customPageSizeToMm(custom)
    : { widthMm: pxToMm(resolved.pageWidthPx), heightMm: pxToMm(resolved.pageHeightPx) };
  return { ...size, guideMarginMm: pxToMm(resolved.marginPx) };
};
