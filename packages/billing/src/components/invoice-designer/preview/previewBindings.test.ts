import { describe, expect, it } from 'vitest';
import type { WasmInvoiceViewModel } from '@alga-psa/types';
import { resolveFieldPreviewValue } from './previewBindings';
import { INVOICE_PREVIEW_SAMPLE_SCENARIOS } from './sampleScenarios';

const previewInvoice: WasmInvoiceViewModel = {
  invoiceNumber: 'INV-100',
  issueDate: '2026-02-01',
  dueDate: '2026-02-15',
  currencyCode: 'USD',
  poNumber: 'PO-7781',
  recurringServicePeriodStart: '2026-01-01',
  recurringServicePeriodEnd: '2026-02-01',
  recurringServicePeriodLabel: 'Jan 1, 2026 - Feb 1, 2026',
  customer: {
    name: 'Acme Co.',
    address: '123 Main St',
  },
  tenantClient: {
    name: 'Northwind MSP',
    address: '400 SW Main St',
    logoUrl: null,
  },
  items: [
    {
      id: 'item-1',
      description: 'Monitoring',
      quantity: 2,
      unitPrice: 1000,
      total: 2000,
    },
  ],
  subtotal: 2000,
  tax: 100,
  total: 2100,
};

describe('previewBindings', () => {
  it('prefers bound preview data values when available', () => {
    const value = resolveFieldPreviewValue({
      invoice: previewInvoice,
      bindingKey: 'invoice.number',
      format: 'text',
    });
    expect(value.text).toBe('INV-100');
  });

  it('returns null when binding is missing so scaffold fallback can apply', () => {
    const value = resolveFieldPreviewValue({
      invoice: previewInvoice,
      bindingKey: 'invoice.unknownField',
      format: 'text',
    });
    expect(value.text).toBeNull();
  });

  it('formats date and currency bindings', () => {
    const dateValue = resolveFieldPreviewValue({
      invoice: previewInvoice,
      bindingKey: 'invoice.issueDate',
      format: 'date',
    });
    const currencyValue = resolveFieldPreviewValue({
      invoice: previewInvoice,
      bindingKey: 'invoice.total',
      format: 'currency',
    });

    expect(dateValue.text).toMatch(/\d{1,2}\/\d{1,2}\/\d{4}/);
    expect(currencyValue.text).toBe('$21.00');
  });

  it('resolves recurring service period header bindings', () => {
    const startValue = resolveFieldPreviewValue({
      invoice: previewInvoice,
      bindingKey: 'invoice.recurringServicePeriodStart',
      format: 'date',
    });
    const labelValue = resolveFieldPreviewValue({
      invoice: previewInvoice,
      bindingKey: 'invoice.recurringServicePeriodLabel',
      format: 'text',
    });

    expect(startValue.text).toMatch(/\d{1,2}\/\d{1,2}\/\d{4}/);
    expect(labelValue.text).toBe('Jan 1, 2026 - Feb 1, 2026');
  });

  // The editor canvas is handed a quote render model but the designer speaks picker paths, so a
  // quote binding key has to resolve through the quote catalog's snake_case path.
  it('resolves quote picker paths against a quote render model', () => {
    const quoteModel = {
      quote_number: 'QT-2026-0042',
      total_amount: 94830,
      currencyCode: 'USD',
      tenant: { name: 'Northwind MSP', address: '400 SW Main St' },
    } as unknown as WasmInvoiceViewModel;

    expect(
      resolveFieldPreviewValue({ invoice: quoteModel, bindingKey: 'quote.quoteNumber', format: 'text' }).text
    ).toBe('QT-2026-0042');
    expect(
      resolveFieldPreviewValue({ invoice: quoteModel, bindingKey: 'quote.total', format: 'currency' }).text
    ).toBe('$948.30');
    expect(
      resolveFieldPreviewValue({ invoice: quoteModel, bindingKey: 'tenant.name', format: 'text' }).text
    ).toBe('Northwind MSP');
  });

  // The persisted subtotal is already net of discount lines, so there is still no derived
  // `invoice.discount`; the real figure is the explicit `invoice.discountTotal` (alga0002295).
  it('keeps invoice.discount unresolved and resolves invoice.discountTotal / grossSubtotal from the model', () => {
    const invoice = {
      ...previewInvoice,
      subtotal: 2000,
      tax: 100,
      total: 2100,
      discountTotal: 500,
      grossSubtotal: 2500,
    };

    expect(resolveFieldPreviewValue({ invoice, bindingKey: 'invoice.discount', format: 'currency' }).text).toBeNull();
    expect(resolveFieldPreviewValue({ invoice, bindingKey: 'invoice.discountTotal', format: 'currency' }).text).toBe('$5.00');
    expect(resolveFieldPreviewValue({ invoice, bindingKey: 'invoice.grossSubtotal', format: 'currency' }).text).toBe('$25.00');
  });

  it('keeps sample scenarios consistent: subtotal equals grossSubtotal minus discountTotal', () => {
    for (const scenario of INVOICE_PREVIEW_SAMPLE_SCENARIOS) {
      const { subtotal, grossSubtotal, discountTotal } = scenario.data;
      expect(grossSubtotal! - discountTotal!).toBe(subtotal);
    }
    const byId = (id: string) => INVOICE_PREVIEW_SAMPLE_SCENARIOS.find((scenario) => scenario.id === id)!.data;
    expect(byId('sample-discount-credit')).toMatchObject({ discountTotal: 15000, grossSubtotal: 195000, subtotal: 180000 });
    expect(byId('sample-mixed-recurring')).toMatchObject({ discountTotal: 15000, grossSubtotal: 595400, subtotal: 580400 });
  });

  it('returns null recurring service period header bindings when canonical summary is missing', () => {
    const value = resolveFieldPreviewValue({
      invoice: {
        ...previewInvoice,
        recurringServicePeriodStart: null,
        recurringServicePeriodEnd: null,
        recurringServicePeriodLabel: null,
      },
      bindingKey: 'invoice.recurringServicePeriodLabel',
      format: 'text',
    });

    expect(value.text).toBeNull();
  });

  it('does not mirror customer address when tenant address is missing', () => {
    const value = resolveFieldPreviewValue({
      invoice: {
        ...previewInvoice,
        tenantClient: null,
      },
      bindingKey: 'tenant.address',
      format: 'text',
    });

    expect(value.text).toBeNull();
  });

  it('formats address bindings as multiline blocks when requested', () => {
    const value = resolveFieldPreviewValue({
      invoice: {
        ...previewInvoice,
        tenantClient: {
          ...previewInvoice.tenantClient!,
          address: '400 SW Main St, , Portland, OR 97204',
        },
      },
      bindingKey: 'tenant.address',
      format: 'text',
      displayFormat: 'multiline',
    });

    expect(value.text).toBe('400 SW Main St\nPortland\nOR 97204');
    expect(value.multiline).toBe(true);
  });

  it('treats client.address as a synonym for customer.address', () => {
    const value = resolveFieldPreviewValue({
      invoice: {
        ...previewInvoice,
        customer: {
          ...previewInvoice.customer!,
          address: '901 Harbor Ave, Seattle, WA 98104',
        },
      },
      bindingKey: 'client.address',
      format: 'text',
      displayFormat: 'multiline',
    });

    expect(value.text).toBe('901 Harbor Ave\nSeattle\nWA 98104');
    expect(value.multiline).toBe(true);
  });
});
