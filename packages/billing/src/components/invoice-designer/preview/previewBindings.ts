import type { TemplateFieldDisplayFormat, WasmInvoiceViewModel } from '@alga-psa/types';
import {
  formatTemplateFieldValue,
  normalizeFieldFormat as normalizeTemplateFieldFormat,
} from '../../../lib/invoice-template-ast/fieldFormatting';
import { resolveInvoiceTemplateBindingAlias } from '../../../lib/invoice-template-ast/bindingAliases';

const asTrimmedString = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

const isNullish = (value: unknown): value is null | undefined => value === null || value === undefined;
const supportsAddressDisplayFormat = (bindingKey: string): boolean => asTrimmedString(bindingKey).endsWith('.address');

const flattenInvoiceBindingMap = (invoice: WasmInvoiceViewModel): Record<string, unknown> => ({
  'invoice.discount': Math.max(0, (invoice.subtotal ?? 0) + (invoice.tax ?? 0) - (invoice.total ?? 0)),
  'invoice.number': invoice.invoiceNumber,
  'invoice.invoiceNumber': invoice.invoiceNumber,
  'invoice.issueDate': invoice.issueDate,
  'invoice.dueDate': invoice.dueDate,
  'invoice.poNumber': invoice.poNumber,
  'invoice.subtotal': invoice.subtotal,
  'invoice.tax': invoice.tax,
  'invoice.total': invoice.total,
  'invoice.currencyCode': invoice.currencyCode,
  'customer.name': invoice.customer?.name,
  'customer.address': invoice.customer?.address,
  'tenant.name': invoice.tenantClient?.name,
  'tenant.address': invoice.tenantClient?.address,
});

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

  // Last-chance resolver for direct dotted paths in the model shape.
  const pathSegments = aliasedKey.split('.').filter(Boolean);
  let cursor: unknown = invoice;
  for (const segment of pathSegments) {
    if (isNullish(cursor) || typeof cursor !== 'object') {
      return null;
    }
    cursor = (cursor as Record<string, unknown>)[segment];
  }
  return cursor;
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
  item: WasmInvoiceViewModel['items'][number],
  columnKey: string
): unknown => {
  const normalizedKey = asTrimmedString(columnKey);
  if (!normalizedKey) {
    return null;
  }
  if (normalizedKey.startsWith('item.')) {
    return item[normalizedKey.slice('item.'.length) as keyof typeof item];
  }
  return resolveInvoiceBindingRawValue(invoice, normalizedKey);
};
