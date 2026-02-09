import type { WasmInvoiceViewModel } from '@alga-psa/types';

type FieldFormat = 'text' | 'number' | 'currency' | 'date';

const asTrimmedString = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

const isNullish = (value: unknown): value is null | undefined => value === null || value === undefined;

const formatCurrency = (value: number, currencyCode: string) => {
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currencyCode || 'USD',
    }).format(value / 100);
  } catch {
    return `$${(value / 100).toFixed(2)}`;
  }
};

const formatDate = (value: string) => {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return parsed.toLocaleDateString('en-US');
};

export const normalizeFieldFormat = (value: unknown): FieldFormat => {
  const normalized = asTrimmedString(value).toLowerCase();
  if (normalized === 'number' || normalized === 'currency' || normalized === 'date') {
    return normalized;
  }
  return 'text';
};

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

  // Last-chance resolver for direct dotted paths in the model shape.
  const pathSegments = normalizedKey.split('.').filter(Boolean);
  let cursor: unknown = invoice;
  for (const segment of pathSegments) {
    if (isNullish(cursor) || typeof cursor !== 'object') {
      return null;
    }
    cursor = (cursor as Record<string, unknown>)[segment];
  }
  return cursor;
};

export const formatBoundValue = (
  value: unknown,
  format: FieldFormat,
  currencyCode: string
): string | null => {
  if (isNullish(value)) {
    return null;
  }

  if (typeof value === 'string') {
    if (value.length === 0) {
      return null;
    }
    if (format === 'date') {
      return formatDate(value);
    }
    if (format === 'number') {
      const asNumber = Number(value);
      return Number.isFinite(asNumber) ? String(asNumber) : value;
    }
    if (format === 'currency') {
      const asNumber = Number(value);
      if (!Number.isFinite(asNumber)) {
        return value;
      }
      return formatCurrency(asNumber, currencyCode);
    }
    return value;
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      return null;
    }
    if (format === 'currency') {
      return formatCurrency(value, currencyCode);
    }
    if (format === 'date') {
      return formatDate(String(value));
    }
    return String(value);
  }

  if (typeof value === 'boolean') {
    return value ? 'Yes' : 'No';
  }

  return null;
};

export const resolveFieldPreviewValue = (params: {
  invoice: WasmInvoiceViewModel | null;
  bindingKey: string;
  format: unknown;
}): string | null => {
  const raw = resolveInvoiceBindingRawValue(params.invoice, params.bindingKey);
  if (isNullish(raw)) {
    return null;
  }
  return formatBoundValue(raw, normalizeFieldFormat(params.format), params.invoice?.currencyCode ?? 'USD');
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

