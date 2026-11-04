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

const pxToMm = (px: number): number => (px * 25.4) / 96;

/**
 * The preview sheet that matches the printed label cell for `ast`, or null when the preview should stay
 * unframed. Only the `label-cell` path is framed: its geometry is exact (one clipped cell, nothing outside
 * the markup), so the sheet is the label.
 *
 * `document` stays unframed because no screen sheet can match its paper today: the PDF path applies the
 * margin twice (Puppeteer `margin` from resolvePdfPrintOptionsFromAst plus the renderer's root padding),
 * and designer-saved templates pin the root to the full page width, so the content only fits because
 * Chromium's print path shrinks overflowing pages to fit. A sheet would clip what the PDF shrinks.
 */
// LEVERAGE: friction document-pdf-margin — document PDFs apply the margin twice and rely on print
// shrink-to-fit; fix the single-document print geometry, then frame `document` previews here too.
export const resolveTemplatePreviewSheetFromAst = (
  ast: TemplateAst | null | undefined,
  geometry: TemplatePrintGeometry
): TemplatePreviewSheet | null => {
  if (geometry !== 'label-cell') {
    return null;
  }
  const resolved = resolveTemplatePrintSettingsFromAst(ast);
  const custom = resolved.source === 'explicit' ? resolved.customPageSize : undefined;
  const size = custom
    ? customPageSizeToMm(custom)
    : { widthMm: pxToMm(resolved.pageWidthPx), heightMm: pxToMm(resolved.pageHeightPx) };
  return { ...size, guideMarginMm: pxToMm(resolved.marginPx) };
};
