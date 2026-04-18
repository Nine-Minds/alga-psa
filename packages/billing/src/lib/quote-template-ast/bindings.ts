import type { TemplateAst } from '@alga-psa/types';

type QuoteTemplateBindings = NonNullable<TemplateAst['bindings']>;
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
  clientAddress: { id: 'clientAddress', kind: 'value', path: 'client.address', fallback: '' },
  contactName: { id: 'contactName', kind: 'value', path: 'contact.name', fallback: '' },
  tenantName: { id: 'tenantName', kind: 'value', path: 'tenant.name', fallback: 'Your Company' },
  tenantAddress: { id: 'tenantAddress', kind: 'value', path: 'tenant.address', fallback: '' },
  tenantLogo: { id: 'tenantLogo', kind: 'value', path: 'tenant.logo_url' },
  acceptedByName: { id: 'acceptedByName', kind: 'value', path: 'accepted_by_name', fallback: '' },
  acceptedAt: { id: 'acceptedAt', kind: 'value', path: 'accepted_at', fallback: '' },
  recurringSubtotal: { id: 'recurringSubtotal', kind: 'value', path: 'recurring_subtotal' },
  recurringTax: { id: 'recurringTax', kind: 'value', path: 'recurring_tax' },
  recurringTotal: { id: 'recurringTotal', kind: 'value', path: 'recurring_total' },
  onetimeSubtotal: { id: 'onetimeSubtotal', kind: 'value', path: 'onetime_subtotal' },
  onetimeTax: { id: 'onetimeTax', kind: 'value', path: 'onetime_tax' },
  onetimeTotal: { id: 'onetimeTotal', kind: 'value', path: 'onetime_total' },
  serviceSubtotal: { id: 'serviceSubtotal', kind: 'value', path: 'service_subtotal' },
  serviceTax: { id: 'serviceTax', kind: 'value', path: 'service_tax' },
  serviceTotal: { id: 'serviceTotal', kind: 'value', path: 'service_total' },
  productSubtotal: { id: 'productSubtotal', kind: 'value', path: 'product_subtotal' },
  productTax: { id: 'productTax', kind: 'value', path: 'product_tax' },
  productTotal: { id: 'productTotal', kind: 'value', path: 'product_total' },
};

export const QUOTE_TEMPLATE_COLLECTION_BINDINGS: QuoteTemplateCollectionBindings = {
  lineItems: { id: 'lineItems', kind: 'collection', path: 'line_items' },
  phases: { id: 'phases', kind: 'collection', path: 'phases' },
  // Pre-computed per-location groupings for templates that want location
  // "bands" (one location + address header + rows + per-location subtotal).
  // Mirrors the `phases` binding shape.
  groupsByLocation: { id: 'groupsByLocation', kind: 'collection', path: 'groups_by_location' },
  recurringItems: { id: 'recurringItems', kind: 'collection', path: 'recurring_items' },
  onetimeItems: { id: 'onetimeItems', kind: 'collection', path: 'onetime_items' },
  serviceItems: { id: 'serviceItems', kind: 'collection', path: 'service_items' },
  productItems: { id: 'productItems', kind: 'collection', path: 'product_items' },
};

export const buildQuoteTemplateBindings = (): QuoteTemplateBindings => ({
  values: {
    ...QUOTE_TEMPLATE_VALUE_BINDINGS,
  },
  collections: {
    ...QUOTE_TEMPLATE_COLLECTION_BINDINGS,
  },
});
