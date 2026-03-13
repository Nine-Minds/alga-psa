import type { InvoiceTemplateAst } from '@alga-psa/types';

type QuoteTemplateBindings = NonNullable<InvoiceTemplateAst['bindings']>;
type QuoteTemplateValueBindings = NonNullable<QuoteTemplateBindings['values']>;
type QuoteTemplateCollectionBindings = NonNullable<QuoteTemplateBindings['collections']>;

export const QUOTE_TEMPLATE_VALUE_BINDINGS: QuoteTemplateValueBindings = {
  quoteNumber: { id: 'quoteNumber', kind: 'value', path: 'quote_number' },
  quoteDate: { id: 'quoteDate', kind: 'value', path: 'quote_date' },
  validUntil: { id: 'validUntil', kind: 'value', path: 'valid_until' },
  status: { id: 'status', kind: 'value', path: 'status' },
  title: { id: 'title', kind: 'value', path: 'title' },
  scope: { id: 'scope', kind: 'value', path: 'scope_of_work', fallback: '' },
  poNumber: { id: 'poNumber', kind: 'value', path: 'po_number' },
  subtotal: { id: 'subtotal', kind: 'value', path: 'subtotal' },
  discountTotal: { id: 'discountTotal', kind: 'value', path: 'discount_total' },
  tax: { id: 'tax', kind: 'value', path: 'tax' },
  total: { id: 'total', kind: 'value', path: 'total_amount' },
  termsAndConditions: {
    id: 'termsAndConditions',
    kind: 'value',
    path: 'terms_and_conditions',
    fallback: '',
  },
  clientNotes: { id: 'clientNotes', kind: 'value', path: 'client_notes', fallback: '' },
  version: { id: 'version', kind: 'value', path: 'version' },
  clientName: { id: 'clientName', kind: 'value', path: 'client.name', fallback: 'Client' },
  contactName: { id: 'contactName', kind: 'value', path: 'contact.name', fallback: '' },
  tenantName: { id: 'tenantName', kind: 'value', path: 'tenant.name', fallback: 'Your Company' },
};

export const QUOTE_TEMPLATE_COLLECTION_BINDINGS: QuoteTemplateCollectionBindings = {
  lineItems: { id: 'lineItems', kind: 'collection', path: 'line_items' },
  phases: { id: 'phases', kind: 'collection', path: 'phases' },
};

export const buildQuoteTemplateBindings = (): QuoteTemplateBindings => ({
  values: {
    ...QUOTE_TEMPLATE_VALUE_BINDINGS,
  },
  collections: {
    ...QUOTE_TEMPLATE_COLLECTION_BINDINGS,
  },
});
