import {
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

