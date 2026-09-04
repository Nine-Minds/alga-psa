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
  bindingKey: string
): unknown => {
  if (!invoice) {
    return null;
  }

  const normalizedKey = asTrimmedString(bindingKey);
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
  currencyCode: string
): string | null =>
  formatTemplateFieldValue({
    value,
    format,
    currencyCode,
  }).text;

export const resolveFieldPreviewValue = (params: {
  invoice: WasmInvoiceViewModel | null;
  bindingKey: string;
  format: unknown;
  displayFormat?: TemplateFieldDisplayFormat | null;
}): { text: string | null; multiline: boolean } => {
  const raw = resolveInvoiceBindingRawValue(params.invoice, params.bindingKey);
  if (isNullish(raw)) {
    return { text: null, multiline: false };
  }
  return formatTemplateFieldValue({
    value: raw,
    format: params.format,
    currencyCode: params.invoice?.currencyCode ?? 'USD',
    displayFormat: supportsAddressDisplayFormat(params.bindingKey) ? params.displayFormat : undefined,
  });
};

export const resolveTableItemBindingRawValue = (
  invoice: WasmInvoiceViewModel | null,
  item: Record<string, unknown>,
  columnKey: string
): unknown => {
  const normalizedKey = asTrimmedString(columnKey);
  if (!normalizedKey) {
    return null;
  }
  // Both authoring prefixes resolve against the current row, mirroring the
  // evaluator's row-scope-first rule ('entry.' is the nested time-entry
  // table's conventional item binding).
  for (const prefix of ['item.', 'entry.', 'group.']) {
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

/**
 * Map a table's collection binding id to the sample rows the WYSIWYG canvas
 * should preview. Known collection bindings resolve to their view-model
 * arrays; unknown ids fall back to `items` so legacy workspaces keep their
 * previous behavior.
 */
const CANVAS_COLLECTION_PATHS: Record<string, keyof WasmInvoiceViewModel> = {
  items: 'items',
  lineItems: 'items',
  recurringItems: 'recurringItems',
  onetimeItems: 'onetimeItems',
  groupsByLocation: 'groupsByLocation',
  ticketGroups: 'ticketGroups',
  timeEntries: 'timeEntries',
};

export const resolveCanvasCollectionRows = (
  invoice: WasmInvoiceViewModel | null,
  sourceBindingId: string
): Record<string, unknown>[] => {
  if (!invoice) {
    return [];
  }
  const path = CANVAS_COLLECTION_PATHS[asTrimmedString(sourceBindingId)] ?? 'items';
  const value: unknown = invoice[path];
  return Array.isArray(value) ? (value as Record<string, unknown>[]) : [];
};
