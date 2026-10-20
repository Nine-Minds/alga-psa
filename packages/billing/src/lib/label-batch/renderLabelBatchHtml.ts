import { customPageSizeToMm, matchRecordPath, recordUrl, type LabelViewModel, type TemplateAst } from '@alga-psa/types';

import { evaluateTemplateAst } from '../invoice-template-ast/evaluator';
import { renderTemplateAstFragment } from '../invoice-template-ast/server-render';
import {
  LABEL_CLASS_BY_STANDARD_CODE,
  LABEL_STANDARD_CODE_BY_CLASS,
  getStandardLabelTemplateAstByCode,
} from '../label-template-ast/standardTemplates';
import { composeLabelSheets, type ComposedLabelDocument, type RenderedLabelCell } from './composeLabelSheets';
import type { LabelBatchLayout } from './layout';

export interface LabelPrintItem {
  viewModel: LabelViewModel;
  /** A standard label template code for this item's label class. Defaults to the class's template. */
  templateCode?: string;
}

export class LabelRenderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LabelRenderError';
  }
}

/**
 * Invariant: the QR content is only the canonical `recordUrl` (no tokens, no secrets). Providers
 * build `url` with `recordUrl`; this re-derives it from the record type, id and the URL's own origin
 * and refuses anything else, so a provider bug cannot put a query token or fragment into a code.
 */
export function assertCanonicalLabelUrl(viewModel: LabelViewModel): void {
  const origin = /^https?:\/\/[^/?#]+/i.exec(viewModel.url)?.[0];
  const matched = matchRecordPath(viewModel.url);
  if (
    !origin ||
    !matched ||
    matched.entityType !== viewModel.entityType ||
    matched.id !== viewModel.recordId ||
    viewModel.url !== recordUrl(viewModel.entityType, viewModel.recordId, origin)
  ) {
    throw new LabelRenderError('Label URL is not the canonical record URL.');
  }
}

function resolveTemplateAst(item: LabelPrintItem): { ast: TemplateAst; code: string } {
  const code = item.templateCode ?? LABEL_STANDARD_CODE_BY_CLASS[item.viewModel.labelClass];
  if (LABEL_CLASS_BY_STANDARD_CODE[code] !== item.viewModel.labelClass) {
    throw new LabelRenderError(`Label template "${code}" does not print "${item.viewModel.labelClass}" labels.`);
  }
  const ast = getStandardLabelTemplateAstByCode(code);
  if (!ast) {
    throw new LabelRenderError(`Unknown label template "${code}".`);
  }
  return { ast, code };
}

/**
 * Render every item to one label cell (template evaluate -> async barcode prepass -> synchronous
 * shared renderer) and compose the cells into a single HTML document in input order.
 * No I/O besides the barcode libraries: no database, no browser, no side effects.
 */
export async function renderLabelBatchHtml(
  items: readonly LabelPrintItem[],
  layout: LabelBatchLayout,
  options: { tenantClient?: { name: string | null; logoUrl: string | null } | null; locale?: string } = {}
): Promise<ComposedLabelDocument> {
  const cells: RenderedLabelCell[] = [];
  for (const [index, item] of items.entries()) {
    assertCanonicalLabelUrl(item.viewModel);
    const { ast, code } = resolveTemplateAst(item);
    const description = `Label ${index + 1} (${code})`;
    const model = { ...item.viewModel, tenantClient: options.tenantClient ?? item.viewModel.tenantClient ?? null };
    try {
      const evaluation = evaluateTemplateAst(ast, model as unknown as Record<string, unknown>);
      const { html, css } = await renderTemplateAstFragment(ast, evaluation, { locale: options.locale });
      const printSettings = ast.metadata?.printSettings;
      cells.push({
        html,
        css,
        marginMm: typeof printSettings?.marginMm === 'number' ? printSettings.marginMm : 0,
        designedSizeMm: printSettings?.customPageSize ? customPageSizeToMm(printSettings.customPageSize) : null,
        description,
      });
    } catch (error) {
      throw new LabelRenderError(`${description}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return composeLabelSheets(cells, layout, { title: 'Labels' });
}
