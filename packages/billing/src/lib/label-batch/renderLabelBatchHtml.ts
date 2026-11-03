import {
  customPageSizeToMm,
  matchRecordPath,
  recordUrl,
  type LabelHideableField,
  type LabelPrintFailure,
  type LabelTenantClient,
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
  /**
   * A label template code for this item's label class. For a standard template it selects the AST;
   * with `templateAst` it is only the name failures are reported under (the custom template's id).
   * Defaults to the class's standard template.
   */
  templateCode?: string;
  /** A resolved tenant custom template. Already validated for the item's class by the caller. */
  templateAst?: TemplateAst;
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
    viewModel.url !== recordUrl(viewModel.entityType, viewModel.recordId, origin, matched.projectId ? { projectId: matched.projectId } : {})
  ) {
    throw new LabelRenderError('Label URL is not the canonical record URL.');
  }
}

/**
 * The model a label template evaluates. Fields the template hides (`metadata.labelSettings.hiddenFields`)
 * are NULLED here, before evaluation, so a hidden value cannot reach the HTML even when a custom text node
 * binds it. `url` and `identifier` are not hideable (the type and the schema both exclude them). The display
 * lines ("Asset {tag}", "S/N ...{suffix}") and the brand text are derived afterwards from what remains.
 */
export function buildLabelModel(
  viewModel: LabelViewModel,
  tenantClient: LabelTenantClient | null | undefined,
  hiddenFields: readonly LabelHideableField[] = []
): LabelViewModel {
  const hidden = new Set<LabelHideableField>(hiddenFields);
  const base = tenantClient ?? viewModel.tenantClient ?? null;
  const name = hidden.has('tenantName') ? null : base?.name ?? null;
  const logoUrl = hidden.has('tenantLogo') ? null : base?.logoUrl ?? null;
  const secondaryIdentifier = hidden.has('secondaryIdentifier') ? null : viewModel.secondaryIdentifier;
  const serialSuffix = hidden.has('serialSuffix') ? null : viewModel.serialSuffix;
  const custodyLocation = hidden.has('custodyLocation') ? null : viewModel.custodyLocation ?? null;
  const nextAction = hidden.has('nextAction') ? null : viewModel.nextAction ?? null;
  // Line budget: the two held-equipment lines take the work-reason and serial lines' place (the 4x2 in tag
  // has no spare height). The asset line still names the held device; its serial suffix yields.
  const custodyPrints = viewModel.labelClass === 'ticket-work-tag' && Boolean(custodyLocation || nextAction);
  return {
    ...viewModel,
    title: hidden.has('title') ? null : viewModel.title,
    clientName: hidden.has('clientName') ? null : viewModel.clientName,
    detail: hidden.has('detail') || custodyPrints ? null : viewModel.detail,
    secondaryIdentifier,
    serialSuffix,
    custodyLocation,
    nextAction,
    tenantClient: base || name || logoUrl ? { name, logoUrl, brandText: logoUrl ? null : name } : null,
    display: {
      assetLine: secondaryIdentifier ? `Asset ${secondaryIdentifier}` : null,
      serialLine: serialSuffix && !custodyPrints ? `S/N \u2026${serialSuffix}` : null,
      sequenceLine: viewModel.sequence ? `Box ${viewModel.sequence.n} of ${viewModel.sequence.total}` : null,
      ...(viewModel.rma
        ? {
            rmaReturnByLine: viewModel.rma.returnBy ? `Return by ${viewModel.rma.returnBy}` : null,
            rmaTicketLine: viewModel.rma.ticketNumber ? `Ticket ${viewModel.rma.ticketNumber}` : null,
          }
        : {}),
    },
  };
}

function resolveTemplateAst(item: LabelPrintItem): { ast: TemplateAst; code: string } {
  if (item.templateAst) {
    return { ast: item.templateAst, code: item.templateCode ?? 'custom' };
  }
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
  options: { tenantClient?: LabelTenantClient | null; locale?: string } = {}
): Promise<ComposedLabelDocument> {
  const cells: RenderedLabelCell[] = [];
  const failures: LabelPrintFailure[] = [];
  // All-or-nothing, but every item is tried so the error names EVERY record that cannot print.
  for (const [index, item] of items.entries()) {
    const templateCode = item.templateCode ?? LABEL_STANDARD_CODE_BY_CLASS[item.viewModel.labelClass];
    try {
      assertCanonicalLabelUrl(item.viewModel);
      const { ast, code } = resolveTemplateAst(item);
      const model = buildLabelModel(item.viewModel, options.tenantClient, ast.metadata?.labelSettings?.hiddenFields);
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
