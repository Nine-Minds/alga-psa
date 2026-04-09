import type { TemplateFieldDisplayFormat } from '@alga-psa/types';

export type InvoiceFieldCategory =
  | 'Invoice'
  | 'Customer'
  | 'Tenant'
  | 'Line Item'
  | 'Quote'
  | 'Quote Totals'
  | 'Client'
  | 'Contact';

export type TemplateFieldKind = 'generic' | 'address';

export type TemplateFieldDefinition = {
  path: string;
  label: string;
  category: InvoiceFieldCategory;
  description: string;
  kind?: TemplateFieldKind;
  supportedDisplayFormats?: TemplateFieldDisplayFormat[];
};

const FIELD_DEFINITIONS: Record<string, TemplateFieldDefinition> = {
  'invoice.number': {
    path: 'invoice.number',
    label: 'Invoice Number',
    category: 'Invoice',
    description: 'The invoice number shown to the customer.',
  },
  'invoice.invoiceNumber': {
    path: 'invoice.invoiceNumber',
    label: 'Invoice Number',
    category: 'Invoice',
    description: 'The invoice number shown to the customer.',
  },
  'invoice.issueDate': {
    path: 'invoice.issueDate',
    label: 'Issue Date',
    category: 'Invoice',
    description: 'The date the invoice was issued.',
  },
  'invoice.dueDate': {
    path: 'invoice.dueDate',
    label: 'Due Date',
    category: 'Invoice',
    description: 'The date payment is due.',
  },
  'invoice.poNumber': {
    path: 'invoice.poNumber',
    label: 'PO Number',
    category: 'Invoice',
    description: 'The purchase order reference for this invoice.',
  },
  'invoice.subtotal': {
    path: 'invoice.subtotal',
    label: 'Subtotal',
    category: 'Invoice',
    description: 'The invoice subtotal before tax and discounts.',
  },
  'invoice.tax': {
    path: 'invoice.tax',
    label: 'Tax',
    category: 'Invoice',
    description: 'The tax amount for the invoice.',
  },
  'invoice.discount': {
    path: 'invoice.discount',
    label: 'Discount',
    category: 'Invoice',
    description: 'The invoice discount amount.',
  },
  'invoice.total': {
    path: 'invoice.total',
    label: 'Total',
    category: 'Invoice',
    description: 'The total amount due on the invoice.',
  },
  'invoice.currencyCode': {
    path: 'invoice.currencyCode',
    label: 'Currency Code',
    category: 'Invoice',
    description: 'The ISO currency code for this invoice.',
  },
  'invoice.recurringServicePeriodStart': {
    path: 'invoice.recurringServicePeriodStart',
    label: 'Recurring Service Period Start',
    category: 'Invoice',
    description: 'The canonical recurring invoice service period start date when available.',
  },
  'invoice.recurringServicePeriodEnd': {
    path: 'invoice.recurringServicePeriodEnd',
    label: 'Recurring Service Period End',
    category: 'Invoice',
    description: 'The canonical recurring invoice service period end date when available.',
  },
  'invoice.recurringServicePeriodLabel': {
    path: 'invoice.recurringServicePeriodLabel',
    label: 'Recurring Service Period',
    category: 'Invoice',
    description: 'A formatted canonical recurring invoice service period label when available.',
  },
  'customer.name': {
    path: 'customer.name',
    label: 'Customer Name',
    category: 'Customer',
    description: 'The customer name shown on the invoice.',
  },
  'customer.address': {
    path: 'customer.address',
    label: 'Customer Address',
    category: 'Customer',
    description: 'The customer billing address.',
    kind: 'address',
    supportedDisplayFormats: ['single-line', 'multiline', 'raw'],
  },
  'client.name': {
    path: 'client.name',
    label: 'Client Name',
    category: 'Client',
    description: 'The client name shown in quote-style templates.',
  },
  'client.address': {
    path: 'client.address',
    label: 'Client Address',
    category: 'Client',
    description: 'The client address.',
    kind: 'address',
    supportedDisplayFormats: ['single-line', 'multiline', 'raw'],
  },
  'contact.name': {
    path: 'contact.name',
    label: 'Contact Name',
    category: 'Contact',
    description: 'The contact name shown in quote-style templates.',
  },
  'contact.address': {
    path: 'contact.address',
    label: 'Contact Address',
    category: 'Contact',
    description: 'The contact address.',
    kind: 'address',
    supportedDisplayFormats: ['single-line', 'multiline', 'raw'],
  },
  'tenant.name': {
    path: 'tenant.name',
    label: 'Tenant Name',
    category: 'Tenant',
    description: 'Your company name.',
  },
  'tenant.address': {
    path: 'tenant.address',
    label: 'Tenant Address',
    category: 'Tenant',
    description: 'Your company address.',
    kind: 'address',
    supportedDisplayFormats: ['single-line', 'multiline', 'raw'],
  },
  'tenantClient.name': {
    path: 'tenantClient.name',
    label: 'Tenant Name',
    category: 'Tenant',
    description: 'Your company name.',
  },
  'tenantClient.address': {
    path: 'tenantClient.address',
    label: 'Tenant Address',
    category: 'Tenant',
    description: 'Your company address.',
    kind: 'address',
    supportedDisplayFormats: ['single-line', 'multiline', 'raw'],
  },
};

export const humanizeBindingToken = (input: string): string =>
  input
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[._\-/#:]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)
    .map((part) => {
      if (part.length <= 2) {
        return part.toUpperCase();
      }
      return `${part.charAt(0).toUpperCase()}${part.slice(1).toLowerCase()}`;
    })
    .join(' ');

export const getTemplateFieldDefinition = (bindingKey: string): TemplateFieldDefinition | null => {
  const normalized = bindingKey.trim();
  return FIELD_DEFINITIONS[normalized] ?? null;
};

export const resolveTemplateFieldLabel = (bindingKey: string): string => {
  const normalized = bindingKey.trim();
  if (!normalized) {
    return 'Unbound';
  }
  return getTemplateFieldDefinition(normalized)?.label ?? humanizeBindingToken(normalized);
};

export const getTemplateFieldDisplayFormats = (bindingKey: string): TemplateFieldDisplayFormat[] =>
  getTemplateFieldDefinition(bindingKey)?.supportedDisplayFormats ?? [];
