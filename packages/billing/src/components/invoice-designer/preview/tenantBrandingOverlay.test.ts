import { describe, expect, it } from 'vitest';
import type { LabelViewModel, QuoteViewModel, WasmInvoiceViewModel } from '@alga-psa/types';

import type { TenantParty } from '../../../lib/adapters/tenantPartyAdapter';
import {
  overlayInvoiceSampleTenant,
  overlayLabelSampleTenant,
  overlayQuoteSampleTenant,
  overlaySalesOrderSampleTenant,
} from './tenantBrandingOverlay';

const realParty: TenantParty = {
  name: 'Cascade IT Partners',
  address: '88 Pearl St, Boulder, CO 80302',
  email: 'billing@cascadeit.example',
  phone: '+1-303-555-0114',
  logo_url: 'https://cdn.example/logo.png',
};

const buildQuoteSample = (): QuoteViewModel => ({
  quote_id: 'q-1',
  quote_number: 'QT-1',
  title: 'Managed Services Proposal',
  quote_date: '2026-03-01',
  status: 'sent',
  version: 1,
  currency_code: 'USD',
  subtotal: 0,
  discount_total: 0,
  tax: 0,
  total_amount: 0,
  tenant: { name: 'Northwind MSP', address: '400 SW Main St, Portland, OR 97204' },
  line_items: [],
  phases: [],
});

const buildInvoiceSample = (): WasmInvoiceViewModel => ({
  invoiceNumber: 'INV-1',
  issueDate: '2026-02-01',
  dueDate: '2026-02-15',
  currencyCode: 'USD',
  customer: { name: 'Blue Harbor Dental', address: '901 Harbor Ave' },
  tenantClient: { name: 'Northwind MSP', address: '400 SW Main St', logoUrl: null },
  items: [],
  subtotal: 0,
  tax: 0,
  total: 0,
});

const buildSalesOrderSample = (): Record<string, unknown> => ({
  so_number: 'SO-00042',
  customer: { name: 'Acme Corp', address: '123 Main St' },
  tenantClient: {
    name: 'Northwind MSP',
    address: '400 SW Main St, Portland, OR 97204',
    email: null,
    phone: null,
    logo_url: null,
  },
});

const buildLabelSample = (): LabelViewModel =>
  ({
    labelClass: 'ticket-work-tag',
    identifier: 'TKT-0042',
    tenantClient: { name: 'Northwind MSP', logoUrl: null, brandText: 'Northwind MSP' },
  }) as unknown as LabelViewModel;

describe('tenantBrandingOverlay', () => {
  it('replaces the quote sample issuer with the tenant party (snake_case logo_url)', () => {
    const overlaid = overlayQuoteSampleTenant(buildQuoteSample(), realParty);

    expect(overlaid.tenant).toEqual({
      name: 'Cascade IT Partners',
      address: '88 Pearl St, Boulder, CO 80302',
      email: 'billing@cascadeit.example',
      phone: '+1-303-555-0114',
      logo_url: 'https://cdn.example/logo.png',
    });
    expect(overlaid.quote_number).toBe('QT-1');
  });

  it('replaces the invoice sample issuer with the tenant party (camelCase logoUrl)', () => {
    const overlaid = overlayInvoiceSampleTenant(buildInvoiceSample(), realParty);

    expect(overlaid.tenantClient).toEqual({
      name: 'Cascade IT Partners',
      address: '88 Pearl St, Boulder, CO 80302',
      logoUrl: 'https://cdn.example/logo.png',
    });
    expect(overlaid.customer.name).toBe('Blue Harbor Dental');
  });

  it('replaces the sales order sample issuer on the tenantClient binding path', () => {
    const overlaid = overlaySalesOrderSampleTenant(buildSalesOrderSample(), realParty);

    expect(overlaid.tenantClient).toEqual({
      name: 'Cascade IT Partners',
      address: '88 Pearl St, Boulder, CO 80302',
      email: 'billing@cascadeit.example',
      phone: '+1-303-555-0114',
      logo_url: 'https://cdn.example/logo.png',
    });
    expect(overlaid.customer).toEqual({ name: 'Acme Corp', address: '123 Main St' });
  });

  it('replaces the label sample issuer with the tenant party in the camelCase LabelTenantClient shape', () => {
    const overlaid = overlayLabelSampleTenant(buildLabelSample(), realParty);

    expect(overlaid.tenantClient).toEqual({
      name: 'Cascade IT Partners',
      logoUrl: 'https://cdn.example/logo.png',
      // The name shows as a text brand only when there is no logo.
      brandText: null,
    });
    expect(overlaid.identifier).toBe('TKT-0042');
  });

  it('falls back to the text brand line when the tenant party has no logo', () => {
    const overlaid = overlayLabelSampleTenant(buildLabelSample(), {
      name: 'Solo Shop',
      address: null,
      email: null,
      phone: null,
      logo_url: null,
    });

    expect(overlaid.tenantClient).toEqual({ name: 'Solo Shop', logoUrl: null, brandText: 'Solo Shop' });
  });

  it('leaves the synthetic sample issuer in place when no tenant party resolves', () => {
    const quote = buildQuoteSample();
    const invoice = buildInvoiceSample();
    const salesOrder = buildSalesOrderSample();
    const label = buildLabelSample();

    expect(overlayLabelSampleTenant(label, null)).toBe(label);
    expect(overlayLabelSampleTenant(label, null).tenantClient?.name).toBe('Northwind MSP');

    expect(overlayQuoteSampleTenant(quote, null)).toBe(quote);
    expect(overlayQuoteSampleTenant(quote, null).tenant?.name).toBe('Northwind MSP');
    expect(overlayInvoiceSampleTenant(invoice, null)).toBe(invoice);
    expect(overlayInvoiceSampleTenant(invoice, null).tenantClient?.name).toBe('Northwind MSP');
    expect(overlaySalesOrderSampleTenant(salesOrder, null)).toBe(salesOrder);
    expect((overlaySalesOrderSampleTenant(salesOrder, null).tenantClient as { name: string }).name)
      .toBe('Northwind MSP');
  });

  it('never mutates the shared sample singletons it is handed', () => {
    const quote = buildQuoteSample();
    const invoice = buildInvoiceSample();
    const salesOrder = buildSalesOrderSample();

    const quoteBefore = structuredClone(quote);
    const invoiceBefore = structuredClone(invoice);
    const salesOrderBefore = structuredClone(salesOrder);

    overlayQuoteSampleTenant(quote, realParty);
    overlayInvoiceSampleTenant(invoice, realParty);
    overlaySalesOrderSampleTenant(salesOrder, realParty);

    expect(quote).toEqual(quoteBefore);
    expect(invoice).toEqual(invoiceBefore);
    expect(salesOrder).toEqual(salesOrderBefore);
  });

  it('maps a tenant with no logo or address to explicit nulls rather than dropping the fields', () => {
    const bareParty: TenantParty = {
      name: 'Solo Shop',
      address: null,
      email: null,
      phone: null,
      logo_url: null,
    };

    expect(overlayQuoteSampleTenant(buildQuoteSample(), bareParty).tenant).toEqual({
      name: 'Solo Shop',
      address: null,
      email: null,
      phone: null,
      logo_url: null,
    });
    expect(overlayInvoiceSampleTenant(buildInvoiceSample(), bareParty).tenantClient).toEqual({
      name: 'Solo Shop',
      address: null,
      logoUrl: null,
    });
    expect(overlaySalesOrderSampleTenant(buildSalesOrderSample(), bareParty).tenantClient).toEqual({
      name: 'Solo Shop',
      address: null,
      email: null,
      phone: null,
      logo_url: null,
    });
  });
});
