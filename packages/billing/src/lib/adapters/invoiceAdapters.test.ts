import { describe, expect, it } from 'vitest';
import { mapDbInvoiceToWasmViewModel } from './invoiceAdapters';

describe('mapDbInvoiceToWasmViewModel', () => {
  it('maps db invoice payload numeric and string fields into wasm preview model', () => {
    const mapped = mapDbInvoiceToWasmViewModel({
      invoice_number: 'INV-500',
      invoice_date: '2026-02-01',
      due_date: '2026-02-15',
      currency_code: 'USD',
      po_number: 'PO-1',
      tax_source: 'internal',
      client: {
        name: 'Acme',
        address: '123 Main',
      },
      invoice_charges: [
        {
          item_id: 'item-1',
          description: 'Managed Service',
          quantity: '2',
          unit_price: '1000',
          total_price: '2000',
        },
      ],
      subtotal: '2000',
      tax: '100',
      total: '2100',
    });

    expect(mapped).not.toBeNull();
    expect(mapped?.invoiceNumber).toBe('INV-500');
    expect(mapped?.customer.name).toBe('Acme');
    expect(mapped?.items[0]).toMatchObject({
      id: 'item-1',
      quantity: 2,
      unitPrice: 1000,
      total: 2000,
    });
    expect(mapped?.subtotal).toBe(2000);
    expect(mapped?.tax).toBe(100);
    expect(mapped?.total).toBe(2100);
  });

  it('handles nullable/partial values safely', () => {
    const mapped = mapDbInvoiceToWasmViewModel({
      invoice_number: null,
      invoice_date: null,
      due_date: null,
      client: {
        name: null,
        address: null,
      },
      invoice_charges: [
        {
          item_id: null,
          description: null,
          quantity: null,
          unit_price: null,
          total_price: null,
        },
      ],
      subtotal: null,
      tax: null,
      total: null,
    });

    expect(mapped).not.toBeNull();
    expect(mapped?.invoiceNumber).toBe('N/A');
    expect(mapped?.items[0].quantity).toBe(0);
    expect(mapped?.items[0].unitPrice).toBe(0);
    expect(mapped?.items[0].total).toBe(0);
    expect(mapped?.subtotal).toBe(0);
    expect(mapped?.tax).toBe(0);
    expect(mapped?.total).toBe(0);
  });

  it('normalizes legacy existing-invoice major-unit payloads into minor units', () => {
    const mapped = mapDbInvoiceToWasmViewModel({
      invoice_number: 'INV-005',
      invoice_date: '2026-01-01',
      due_date: '2026-02-16',
      currency_code: 'USD',
      client: {
        name: 'Emerald City',
        address: '1010 Emerald Street',
      },
      invoice_charges: [
        {
          item_id: 'line-1',
          description: 'Premium Rabbit Tracking Services',
          quantity: 50,
          unit_price: 125,
          total_price: 6250,
        },
        {
          item_id: 'line-2',
          description: 'Monthly Looking Glass Maintenance',
          quantity: 1,
          unit_price: 1250,
          total_price: 1250,
        },
      ],
      subtotal: 0,
      tax: 0,
      total: 7500,
    });

    expect(mapped).not.toBeNull();
    expect(mapped?.items[0].unitPrice).toBe(12_500);
    expect(mapped?.items[0].total).toBe(625_000);
    expect(mapped?.items[1].unitPrice).toBe(125_000);
    expect(mapped?.subtotal).toBe(750_000);
    expect(mapped?.total).toBe(750_000);
  });

  it('keeps canonical minor-unit payloads unchanged', () => {
    const mapped = mapDbInvoiceToWasmViewModel({
      invoice_number: 'INV-2026-0147',
      invoice_date: '2026-02-06',
      due_date: '2026-02-20',
      currency_code: 'USD',
      client: {
        name: 'Blue Harbor Dental',
        address: '901 Harbor Ave',
      },
      invoice_charges: [
        {
          item_id: 'svc-monitoring',
          description: 'Managed Endpoint Monitoring',
          quantity: 15,
          unit_price: 4200,
          total_price: 63000,
        },
      ],
      subtotal: 87000,
      tax: 7830,
      total: 94830,
    });

    expect(mapped).not.toBeNull();
    expect(mapped?.items[0].unitPrice).toBe(4200);
    expect(mapped?.items[0].total).toBe(63000);
    expect(mapped?.subtotal).toBe(87000);
    expect(mapped?.tax).toBe(7830);
    expect(mapped?.total).toBe(94830);
  });

  it('maps tenant snapshot details when provided by the invoice query payload', () => {
    const mapped = mapDbInvoiceToWasmViewModel({
      invoice_number: 'INV-601',
      invoice_date: '2026-02-06',
      due_date: '2026-02-20',
      currency_code: 'USD',
      client: {
        name: 'Blue Harbor Dental',
        address: '901 Harbor Ave',
      },
      tenantClientInfo: {
        client_name: 'Northwind MSP',
        location_address: '400 SW Main St',
        logo_url: 'https://cdn.example.com/logo.png',
      },
      invoice_charges: [],
      subtotal: 0,
      tax: 0,
      total: 0,
    });

    expect(mapped).not.toBeNull();
    expect(mapped?.tenantClient).toEqual({
      name: 'Northwind MSP',
      address: '400 SW Main St',
      logoUrl: 'https://cdn.example.com/logo.png',
    });
  });

  it('keeps tenant snapshot null when tenant details are not present', () => {
    const mapped = mapDbInvoiceToWasmViewModel({
      invoice_number: 'INV-602',
      invoice_date: '2026-02-06',
      due_date: '2026-02-20',
      currency_code: 'USD',
      client: {
        name: 'Blue Harbor Dental',
        address: '901 Harbor Ave',
      },
      invoice_charges: [],
      subtotal: 0,
      tax: 0,
      total: 0,
    });

    expect(mapped).not.toBeNull();
    expect(mapped?.tenantClient).toBeNull();
  });
});
