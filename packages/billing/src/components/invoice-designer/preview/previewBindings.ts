import { EMPTY_REPEAT_SCOPE, resolveEvaluatedCollection } from '../../../lib/invoice-template-ast/collectionResolution';
import { evaluateTemplateAst } from '../../../lib/invoice-template-ast/evaluator';
import { buildInvoiceTemplateBindings } from '../../../lib/invoice-template-ast/standardTemplates';
import type { TemplateAst, TemplateNode } from '@alga-psa/types';
import type { TemplateFieldDisplayFormat, WasmInvoiceViewModel } from '@alga-psa/types';
import {
  formatTemplateFieldValue,
  normalizeFieldFormat as normalizeTemplateFieldFormat,
} from '../../../lib/invoice-template-ast/fieldFormatting';
import { resolveInvoiceTemplateBindingAlias } from '../../../lib/invoice-template-ast/bindingAliases';
import { resolveCandidateRenderPaths } from '../fields/documentBindingCatalog';

const asTrimmedString = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

const isNullish = (value: unknown): value is null | undefined => value === null || value === undefined;
const supportsAddressDisplayFormat = (bindingKey: string): boolean => asTrimmedString(bindingKey).endsWith('.address');

const flattenInvoiceBindingMap = (invoice: WasmInvoiceViewModel): Record<string, unknown> => ({
  'invoice.number': invoice.invoiceNumber,
  'invoice.invoiceNumber': invoice.invoiceNumber,
  'invoice.issueDate': invoice.issueDate,
  'invoice.dueDate': invoice.dueDate,
  'invoice.poNumber': invoice.poNumber,
  'invoice.subtotal': invoice.subtotal,
  'invoice.tax': invoice.tax,
  'invoice.total': invoice.total,
  'invoice.currencyCode': invoice.currencyCode,
  'invoice.recurringServicePeriodStart': invoice.recurringServicePeriodStart,
  'invoice.recurringServicePeriodEnd': invoice.recurringServicePeriodEnd,
  'invoice.recurringServicePeriodLabel': invoice.recurringServicePeriodLabel,
  'customer.name': invoice.customer?.name,
  'customer.address': invoice.customer?.address,
  'tenant.name': invoice.tenantClient?.name,
  'tenant.address': invoice.tenantClient?.address,
});

const getModelPathValue = (model: unknown, path: string): unknown => {
  let cursor: unknown = model;
  for (const segment of path.split('.').filter(Boolean)) {
    if (isNullish(cursor) || typeof cursor !== 'object') {
      return undefined;
    }
    cursor = (cursor as Record<string, unknown>)[segment];
  }
  return cursor;
};

export const resolveInvoiceBindingRawValue = (
  invoice: WasmInvoiceViewModel | null,
  bindingKey: string,
  scope?: Record<string, unknown>
): unknown => {
  if (!invoice) {
    return null;
  }

  const normalizedKey = asTrimmedString(bindingKey);
  const scopedValue = scope ? getModelPathValue(scope, normalizedKey) : undefined;
  if (scopedValue !== undefined) return scopedValue;
  if (!normalizedKey) {
    return null;
  }

  const mappedValue = flattenInvoiceBindingMap(invoice)[normalizedKey];
  if (!isNullish(mappedValue)) {
    return mappedValue;
  }

  const aliasedKey = resolveInvoiceTemplateBindingAlias(normalizedKey);
  if (aliasedKey !== normalizedKey) {
    const aliasedValue = flattenInvoiceBindingMap(invoice)[aliasedKey];
    if (!isNullish(aliasedValue)) {
      return aliasedValue;
    }
  }

  // Last-chance resolver: the key as written, then each document type's render path for it —
  // the canvas is handed whichever sample model the editor is previewing.
  for (const candidate of [aliasedKey, ...resolveCandidateRenderPaths(normalizedKey)]) {
    const resolved = getModelPathValue(invoice, candidate);
    if (!isNullish(resolved)) {
      return resolved;
    }
  }
  return null;
};

export const normalizeFieldFormat = normalizeTemplateFieldFormat;

export const formatBoundValue = (
  value: unknown,
  format: unknown,
  currencyCode: string,
  locale?: string
): string | null =>
  formatTemplateFieldValue({
    value,
    format,
    currencyCode,
    locale,
  }).text;

export const resolveFieldPreviewValue = (params: {
  invoice: WasmInvoiceViewModel | null;
  bindingKey: string;
  format: unknown;
  displayFormat?: TemplateFieldDisplayFormat | null;
  locale?: string;
  scope?: Record<string, unknown>;
}): { text: string | null; multiline: boolean } => {
  const raw = resolveInvoiceBindingRawValue(params.invoice, params.bindingKey, params.scope);
  if (isNullish(raw)) {
    return { text: null, multiline: false };
  }
  return formatTemplateFieldValue({
    value: raw,
    format: params.format,
    locale: params.locale,
    currencyCode: params.invoice?.currencyCode ?? 'USD',
    displayFormat: supportsAddressDisplayFormat(params.bindingKey) ? params.displayFormat : undefined,
  });
};

export const resolveTableItemBindingRawValue = (
  invoice: WasmInvoiceViewModel | null,
  item: Record<string, unknown>,
  columnKey: string,
  rowBinding = 'item',
): unknown => {
  const normalizedKey = asTrimmedString(columnKey);
  if (!normalizedKey) {
    return null;
  }
  // Both authoring prefixes resolve against the current row, mirroring the
  // evaluator's row-scope-first rule ('entry.' is the nested time-entry
  // table's conventional item binding).
  for (const prefix of [`${rowBinding}.`, 'item.', 'entry.', 'group.']) {
    if (normalizedKey.startsWith(prefix)) {
      return getModelPathValue(item, normalizedKey.slice(prefix.length));
    }
  }
  const rowValue = getModelPathValue(item, normalizedKey);
  if (!isNullish(rowValue)) {
    return rowValue;
  }
  return resolveInvoiceBindingRawValue(invoice, normalizedKey);
};

/** Resolve the same evaluated collection used by full preview/PDF. Explicit
 * unknown bindings never substitute canonical items. Row scope supports nested detail. */
export const resolveCanvasCollection = (
  invoice: WasmInvoiceViewModel | null,
  sourceBindingId: string,
  ast?: TemplateAst | null,
  scope?: Record<string, unknown>,
): { rows: Record<string, unknown>[]; diagnostic?: string } => {
  if (ast === null) return { rows: [], diagnostic: 'The current layout cannot be evaluated.' };
  if (!invoice) return { rows: [] };
  const id = sourceBindingId.trim();
  const template = ast ?? { kind: 'invoice-template-ast', version: 1, bindings: buildInvoiceTemplateBindings(), layout: { id: 'canvas', type: 'document', children: [] } } as TemplateAst;
  try {
    const evaluation = evaluateTemplateAst(template, invoice as unknown as Record<string, unknown>);
    return resolveEvaluatedCollection(template, evaluation, id, scope);
  } catch (error) {
    return { rows: [], diagnostic: error instanceof Error ? error.message : String(error) };
  }
};

export const resolveCanvasCollectionRows = (
  invoice: WasmInvoiceViewModel | null,
  sourceBindingId: string,
  ast?: TemplateAst | null,
  scope?: Record<string, unknown>,
): Record<string, unknown>[] => resolveCanvasCollection(invoice, sourceBindingId, ast, scope).rows;

/** Canvas shows the first repetition of an imported repeating region. Resolve
 * that region's actual row scope so nested detail never borrows invoice items. */
export function resolveCanvasRowScope(invoice: WasmInvoiceViewModel | null, ast: TemplateAst | null | undefined, nodeId: string): Record<string, unknown> | undefined {
  if (!ast) return undefined;
  let result: Record<string, unknown> | undefined;
  const visit = (node: TemplateNode, scope: Record<string, unknown>): boolean => {
    if (node.id === nodeId) { result = scope; return true; }
    let childScope = scope;
    if (node.type === 'stack' && node.repeat) {
      const { rows, diagnostic } = resolveCanvasCollection(invoice, node.repeat.sourceBinding.bindingId, ast, scope);
      childScope = { ...scope, [node.repeat.itemBinding]: rows[0] ?? {}, ...(!diagnostic && rows.length === 0 ? { [EMPTY_REPEAT_SCOPE]: true } : {}) };
    }
    return 'children' in node && (node.children?.some((child) => visit(child, childScope)) ?? false);
  };
  visit(ast.layout, {});
  return result;
}
