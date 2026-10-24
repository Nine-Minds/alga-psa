import {
  customPageSizeToMm,
  matchRecordPath,
  recordUrl,
  type LabelPrintFailure,
  type LabelViewModel,
  type TemplateAst,
} from '@alga-psa/types';

import { evaluateTemplateAst } from '../invoice-template-ast/evaluator';
import { renderTemplateAstFragment } from '../invoice-template-ast/server-render';
import { BarcodeError } from '../invoice-template-ast/barcode/constraints';
import {
  LABEL_CLASS_BY_STANDARD_CODE,
  LABEL_FALLBACK_TEMPLATE_BY_CODE,
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
  /** Every record of the batch that could not be rendered (empty for request-level errors). */
  readonly failures: LabelPrintFailure[];
  constructor(message: string, failures: LabelPrintFailure[] = []) {
    super(message);
    this.name = 'LabelRenderError';
    this.failures = failures;
  }
}

function batchFailureMessage(failures: readonly LabelPrintFailure[], total: number): string {
  const lines = failures.map((f) => `Label ${f.index + 1} (${f.identifier}, ${f.templateCode}): ${f.message}`);
  const suggestions = Array.from(new Set(failures.map((f) => f.suggestedTemplateCode).filter(Boolean)));
  const head =
    failures.length === 1 && total === 1
      ? ''
      : `${failures.length} of ${total} labels cannot be printed, so none were. `;
  const tail = suggestions.length ? ` Print ${failures.length === 1 ? 'it' : 'them'} with ${suggestions.join(' or ')} instead.` : '';
  return `${head}${lines.join(' ')}${tail}`;
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
  const failures: LabelPrintFailure[] = [];
  // All-or-nothing, but every item is tried so the error names EVERY record that cannot print.
  for (const [index, item] of items.entries()) {
    const templateCode = item.templateCode ?? LABEL_STANDARD_CODE_BY_CLASS[item.viewModel.labelClass];
    try {
      assertCanonicalLabelUrl(item.viewModel);
      const { ast, code } = resolveTemplateAst(item);
      const model = { ...item.viewModel, tenantClient: options.tenantClient ?? item.viewModel.tenantClient ?? null };
      const evaluation = evaluateTemplateAst(ast, model as unknown as Record<string, unknown>);
      const { html, css } = await renderTemplateAstFragment(ast, evaluation, { locale: options.locale });
      const printSettings = ast.metadata?.printSettings;
      cells.push({
        html,
        css,
        designedSizeMm: printSettings?.customPageSize ? customPageSizeToMm(printSettings.customPageSize) : null,
        description: `Label ${index + 1} (${code})`,
      });
    } catch (error) {
      const fallback = LABEL_FALLBACK_TEMPLATE_BY_CODE[templateCode];
      failures.push({
        index,
        recordId: item.viewModel.recordId,
        identifier: item.viewModel.identifier,
        templateCode,
        message: error instanceof Error ? error.message : String(error),
        // Only a barcode the record's data cannot fit is fixed by switching template.
        ...(fallback && error instanceof BarcodeError ? { suggestedTemplateCode: fallback } : {}),
      });
    }
  }
  if (failures.length > 0) {
    throw new LabelRenderError(batchFailureMessage(failures, items.length), failures);
  }
  return composeLabelSheets(cells, layout, { title: 'Labels' });
}
