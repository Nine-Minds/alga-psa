import type { InvoiceTemplateAst } from '@alga-psa/types';
import { INVOICE_TEMPLATE_AST_VERSION } from '@alga-psa/types';

import { buildQuoteTemplateBindings } from './bindings';

const cloneAst = (ast: InvoiceTemplateAst): InvoiceTemplateAst =>
  JSON.parse(JSON.stringify(ast)) as InvoiceTemplateAst;

const buildStandardQuoteDefaultAst = (): InvoiceTemplateAst => ({
  kind: 'invoice-template-ast',
  version: INVOICE_TEMPLATE_AST_VERSION,
  metadata: {
    templateName: 'Standard Quote Default',
  },
  bindings: buildQuoteTemplateBindings(),
  layout: {
    id: 'root',
    type: 'document',
    children: [
      {
        id: 'quote-header',
        type: 'section',
        title: 'Quote',
        children: [
          { id: 'quote-number', type: 'field', label: 'Quote #', binding: { bindingId: 'quoteNumber' } },
          { id: 'quote-date', type: 'field', label: 'Quote Date', binding: { bindingId: 'quoteDate' }, format: 'date' },
          { id: 'valid-until', type: 'field', label: 'Valid Until', binding: { bindingId: 'validUntil' }, format: 'date' },
          { id: 'client-name', type: 'field', label: 'Client', binding: { bindingId: 'clientName' } },
        ],
      },
      {
        id: 'scope-section',
        type: 'section',
        title: 'Scope of Work',
        children: [
          { id: 'scope-copy', type: 'text', content: { type: 'binding', bindingId: 'scope' } },
        ],
      },
      {
        id: 'line-items',
        type: 'dynamic-table',
        repeat: {
          sourceBinding: { bindingId: 'lineItems' },
          itemBinding: 'item',
        },
        columns: [
          { id: 'description', header: 'Description', value: { type: 'path', path: 'description' } },
          { id: 'quantity', header: 'Qty', value: { type: 'path', path: 'quantity' }, format: 'number' },
          { id: 'unit-price', header: 'Rate', value: { type: 'path', path: 'unit_price' }, format: 'currency' },
          { id: 'amount', header: 'Amount', value: { type: 'path', path: 'total_price' }, format: 'currency' },
        ],
      },
      {
        id: 'totals',
        type: 'totals',
        sourceBinding: { bindingId: 'lineItems' },
        rows: [
          { id: 'subtotal', label: 'Subtotal', value: { type: 'binding', bindingId: 'subtotal' }, format: 'currency' },
          { id: 'discounts', label: 'Discounts', value: { type: 'binding', bindingId: 'discountTotal' }, format: 'currency' },
          { id: 'tax', label: 'Tax', value: { type: 'binding', bindingId: 'tax' }, format: 'currency' },
          { id: 'grand-total', label: 'Total', value: { type: 'binding', bindingId: 'total' }, format: 'currency', emphasize: true },
        ],
      },
      {
        id: 'validity-notice',
        type: 'section',
        title: 'Validity',
        children: [
          { id: 'validity-date', type: 'field', label: 'Pricing valid until', binding: { bindingId: 'validUntil' }, format: 'date' },
        ],
      },
      {
        id: 'terms-section',
        type: 'section',
        title: 'Terms & Conditions',
        children: [
          { id: 'terms-copy', type: 'text', content: { type: 'binding', bindingId: 'termsAndConditions' } },
        ],
      },
    ],
  },
});

export const STANDARD_QUOTE_TEMPLATE_ASTS: Record<string, InvoiceTemplateAst> = {
  'standard-quote-default': buildStandardQuoteDefaultAst(),
};

export const getStandardQuoteTemplateAstByCode = (code: string): InvoiceTemplateAst | null => {
  const ast = STANDARD_QUOTE_TEMPLATE_ASTS[code];

  return ast ? cloneAst(ast) : null;
};
