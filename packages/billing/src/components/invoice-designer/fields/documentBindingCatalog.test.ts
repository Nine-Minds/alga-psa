import { describe, expect, it } from 'vitest';

import { buildInvoiceTemplateBindings } from '../../../lib/invoice-template-ast/standardTemplates';
import { QUOTE_TEMPLATE_VALUE_BINDINGS } from '../../../lib/quote-template-ast/bindings';
import { SALES_ORDER_TEMPLATE_VALUE_BINDINGS } from '../../../lib/sales-order-template-ast/bindings';
import type { DesignerDocumentKind } from '../utils/documentKind';
import { getTemplateFieldDefinition } from './fieldCatalog';
import {
  buildDocumentExpressionPathOptions,
  describeBindingOption,
  getDocumentBindingFields,
  getDocumentTokenPaths,
  resolveCandidateRenderPaths,
  resolveDocumentDisplayPath,
  resolveDocumentFieldLabel,
  resolveDocumentRenderPath,
} from './documentBindingCatalog';

const optionPaths = (documentKind: DesignerDocumentKind): string[] =>
  buildDocumentExpressionPathOptions({ mode: 'template', includeRootPaths: false, documentKind })
    .map((option) => option.path)
    .sort();

const renderPathOf = (documentKind: DesignerDocumentKind, displayPath: string): string | undefined =>
  getDocumentBindingFields(documentKind).find((field) => field.path === displayPath)?.renderPath;

describe('document binding catalog generation', () => {
  it('derives quote options from the quote binding catalog, keeping snake_case render paths', () => {
    expect(renderPathOf('quote', 'quote.quoteNumber')).toBe('quote_number');
    expect(renderPathOf('quote', 'quote.quoteDate')).toBe('quote_date');
    expect(renderPathOf('quote', 'quote.validUntil')).toBe('valid_until');
    expect(renderPathOf('quote', 'quote.total')).toBe('total_amount');
    expect(renderPathOf('quote', 'quote.scope')).toBe('scope_of_work');
    expect(renderPathOf('quote', 'quote.poNumber')).toBe('po_number');
    expect(renderPathOf('quote', 'quote.discountTotal')).toBe('discount_total');
    expect(renderPathOf('quote', 'quote.termsAndConditions')).toBe('terms_and_conditions');
    expect(renderPathOf('quote', 'quote.clientNotes')).toBe('client_notes');
    expect(renderPathOf('quote', 'quote.acceptedByName')).toBe('accepted_by_name');
    expect(renderPathOf('quote', 'quote.acceptedAt')).toBe('accepted_at');
  });

  it('groups the quote recurring/onetime/service/product totals under quoteTotals', () => {
    const totalsOptions = optionPaths('quote').filter((path) => path.startsWith('quoteTotals.'));

    expect(totalsOptions).toEqual([
      'quoteTotals.onetimeSubtotal',
      'quoteTotals.onetimeTax',
      'quoteTotals.onetimeTotal',
      'quoteTotals.productSubtotal',
      'quoteTotals.productTax',
      'quoteTotals.productTotal',
      'quoteTotals.recurringSubtotal',
      'quoteTotals.recurringTax',
      'quoteTotals.recurringTotal',
      'quoteTotals.serviceSubtotal',
      'quoteTotals.serviceTax',
      'quoteTotals.serviceTotal',
    ]);
    expect(renderPathOf('quote', 'quoteTotals.serviceSubtotal')).toBe('service_subtotal');
  });

  it('keeps the quote issuer party on tenant.*, matching QuoteViewModel', () => {
    expect(renderPathOf('quote', 'tenant.name')).toBe('tenant.name');
    expect(renderPathOf('quote', 'tenant.address')).toBe('tenant.address');
    expect(renderPathOf('quote', 'client.name')).toBe('client.name');
    expect(renderPathOf('quote', 'contact.name')).toBe('contact.name');
  });

  it('derives sales-order options, including the previously absent salesOrder.* set', () => {
    expect(renderPathOf('sales-order', 'salesOrder.orderNumber')).toBe('so_number');
    expect(renderPathOf('sales-order', 'salesOrder.orderDate')).toBe('order_date');
    expect(renderPathOf('sales-order', 'salesOrder.expectedShipDate')).toBe('expected_ship_date');
    expect(renderPathOf('sales-order', 'salesOrder.poNumber')).toBe('client_po_number');
    expect(renderPathOf('sales-order', 'salesOrder.currencyCode')).toBe('currency_code');
    expect(renderPathOf('sales-order', 'salesOrder.status')).toBe('status');
    expect(renderPathOf('sales-order', 'salesOrder.notes')).toBe('notes');
    expect(renderPathOf('sales-order', 'salesOrder.subtotal')).toBe('subtotal');
    expect(renderPathOf('sales-order', 'salesOrder.tax')).toBe('tax');
    expect(renderPathOf('sales-order', 'salesOrder.total')).toBe('total');
    // The sales-order model keeps the issuer under tenantClient, unlike the quote model.
    expect(renderPathOf('sales-order', 'tenant.name')).toBe('tenantClient.name');
  });

  it('keeps every invoice option that shipped before, minus invoice.discount', () => {
    const invoiceOptions = new Set(optionPaths('invoice'));

    for (const shipped of [
      'invoice.number',
      'invoice.issueDate',
      'invoice.dueDate',
      'invoice.poNumber',
      'invoice.subtotal',
      'invoice.tax',
      'invoice.total',
      'invoice.currencyCode',
      'invoice.recurringServicePeriodStart',
      'invoice.recurringServicePeriodEnd',
      'invoice.recurringServicePeriodLabel',
      'customer.name',
      'customer.address',
      'tenant.name',
      'tenant.address',
      'item.description',
      'item.quantity',
      'item.unitPrice',
      'item.total',
      'item.servicePeriodStart',
      'item.servicePeriodEnd',
      'item.billingTiming',
    ]) {
      expect(invoiceOptions.has(shipped)).toBe(true);
    }

    expect(invoiceOptions.has('invoice.discount')).toBe(false);
    expect(getTemplateFieldDefinition('invoice.discount')).toBeNull();
  });

  it('offers a picker option for every value binding a document type publishes', () => {
    const catalogs: Array<[DesignerDocumentKind, Record<string, { id: string; path: string }>]> = [
      ['invoice', buildInvoiceTemplateBindings().values as Record<string, { id: string; path: string }>],
      ['quote', QUOTE_TEMPLATE_VALUE_BINDINGS as Record<string, { id: string; path: string }>],
      ['sales-order', SALES_ORDER_TEMPLATE_VALUE_BINDINGS as Record<string, { id: string; path: string }>],
    ];

    for (const [documentKind, catalog] of catalogs) {
      const optionRenderPaths = new Set(
        getDocumentBindingFields(documentKind).map((field) => field.renderPath)
      );
      const missing = Object.values(catalog)
        // Logo bindings feed image nodes, not the field picker.
        .filter((binding) => !/logo/i.test(binding.id))
        .filter((binding) => !optionRenderPaths.has(binding.path))
        .map((binding) => `${documentKind}: ${binding.id} -> ${binding.path}`);

      expect(missing).toEqual([]);
    }
  });

  it('round-trips display paths back to the picker path they came from', () => {
    for (const documentKind of ['invoice', 'quote', 'sales-order'] as DesignerDocumentKind[]) {
      for (const field of getDocumentBindingFields(documentKind)) {
        expect(resolveDocumentRenderPath(documentKind, field.path)).toBe(field.renderPath);
        expect(resolveDocumentDisplayPath(documentKind, field.renderPath)).toBe(field.path);
      }
    }
  });

  it('recognises single-segment text tokens per document type', () => {
    expect(getDocumentTokenPaths('quote').has('quote_number')).toBe(true);
    expect(getDocumentTokenPaths('quote').has('invoiceNumber')).toBe(false);
    expect(getDocumentTokenPaths('invoice').has('invoiceNumber')).toBe(true);
    expect(getDocumentTokenPaths('sales-order').has('so_number')).toBe(true);
  });

  it('resolves the render paths a binding key can mean across document types', () => {
    expect(resolveCandidateRenderPaths('tenant.name')).toEqual(['tenantClient.name', 'tenant.name']);
    expect(resolveCandidateRenderPaths('quote.total')).toEqual(['total_amount']);
    expect(resolveCandidateRenderPaths('nothing.here')).toEqual([]);
  });

  it('labels generated options without repeating the category', () => {
    const quoteNumberOption = buildDocumentExpressionPathOptions({
      mode: 'template',
      includeRootPaths: false,
      documentKind: 'quote',
    }).find((option) => option.path === 'quote.quoteNumber');

    expect(quoteNumberOption).toBeTruthy();
    expect(describeBindingOption(quoteNumberOption!)?.label).toBe('Quote Number');
    expect(resolveDocumentFieldLabel('quote.quoteNumber')).toBe('Quote Number');
    expect(resolveDocumentFieldLabel('salesOrder.expectedShipDate')).toBe('Expected Ship Date');
  });

  it('keeps curated field-catalog labels and display formats over generated ones', () => {
    const addressOption = buildDocumentExpressionPathOptions({
      mode: 'template',
      includeRootPaths: false,
      documentKind: 'invoice',
    }).find((option) => option.path === 'customer.address');

    expect(addressOption).toBeTruthy();
    const described = describeBindingOption(addressOption!);
    expect(described?.label).toBe('Customer Address');
    expect(described?.description).toBe('The customer billing address.');
    expect(getTemplateFieldDefinition('customer.address')?.supportedDisplayFormats).toEqual([
      'single-line',
      'multiline',
      'raw',
    ]);
  });
});
