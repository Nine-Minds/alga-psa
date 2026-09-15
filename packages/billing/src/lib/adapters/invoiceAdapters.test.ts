import { describe, expect, it } from 'vitest';
import {
  buildInvoiceTimeCollections,
  mapDbInvoiceToWasmViewModel,
  type InvoiceTimeCollectionSource,
} from './invoiceAdapters';

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

  it('maps tax-bearing line totals from net amounts while keeping tax in invoice totals', () => {
    const mapped = mapDbInvoiceToWasmViewModel({
      invoice_number: 'INV-TAXED',
      invoice_date: '2026-07-30',
      due_date: '2026-08-15',
      currency_code: 'USD',
      client: { name: 'Taxed Client', address: '1 Main St' },
      invoice_charges: [
        {
          item_id: 'milestone-1',
          description: 'Project milestone',
          quantity: 1,
          unit_price: 10_000,
          net_amount: 10_000,
          tax_amount: 800,
          total_price: 10_800,
        },
      ],
      subtotal: 10_000,
      tax: 800,
      total: null,
    });

    expect(mapped?.items[0]).toMatchObject({ total: 10_000, taxAmount: 800 });
    expect(mapped?.subtotal).toBe(10_000);
    expect(mapped?.tax).toBe(800);
    expect(mapped?.total).toBe(10_800);
  });

  it('leaves discount and zero-tax line displays unchanged', () => {
    const mapped = mapDbInvoiceToWasmViewModel({
      invoice_number: 'INV-NO-TAX',
      invoice_date: '2026-07-30',
      due_date: '2026-08-15',
      currency_code: 'USD',
      client: { name: 'No Tax Client', address: '2 Main St' },
      invoice_charges: [
        {
          item_id: 'service-1',
          description: 'Service',
          quantity: 1,
          unit_price: 10_000,
          net_amount: 10_000,
          tax_amount: 0,
          total_price: 10_000,
        },
        {
          item_id: 'discount-1',
          description: 'Discount',
          quantity: 1,
          unit_price: -1_000,
          net_amount: -1_000,
          tax_amount: 0,
          total_price: -1_000,
        },
      ],
      subtotal: 9_000,
      tax: 0,
      total: 9_000,
    });

    expect(mapped?.items.map((item) => item.total)).toEqual([10_000, -1_000]);
    expect(mapped?.subtotal).toBe(9_000);
    expect(mapped?.total).toBe(9_000);
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

  it('maps canonical recurring invoice header service period fields into the renderer model', () => {
    const mapped = mapDbInvoiceToWasmViewModel({
      invoice_number: 'INV-602A',
      invoice_date: '2026-02-06',
      due_date: '2026-02-20',
      currency_code: 'USD',
      recurring_service_period_start: '2026-01-01T00:00:00.000Z',
      recurring_service_period_end: '2026-02-01T00:00:00.000Z',
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
    expect(mapped?.recurringServicePeriodStart).toBe('2026-01-01T00:00:00.000Z');
    expect(mapped?.recurringServicePeriodEnd).toBe('2026-02-01T00:00:00.000Z');
    expect(mapped?.recurringServicePeriodLabel).toBe('Jan 1, 2026 - Feb 1, 2026');
  });

  it('leaves recurring invoice header service period fields null when canonical summary is incomplete', () => {
    const mapped = mapDbInvoiceToWasmViewModel({
      invoice_number: 'INV-602B',
      invoice_date: '2026-02-06',
      due_date: '2026-02-20',
      currency_code: 'USD',
      recurring_service_period_start: '2026-01-01T00:00:00.000Z',
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
    expect(mapped?.recurringServicePeriodStart).toBe('2026-01-01T00:00:00.000Z');
    expect(mapped?.recurringServicePeriodEnd).toBeNull();
    expect(mapped?.recurringServicePeriodLabel).toBeNull();
  });

  it('T268: invoice rendering adapters produce stable output for invoices containing canonical recurring detail-backed charges', () => {
    const mapped = mapDbInvoiceToWasmViewModel({
      invoice_number: 'INV-603',
      invoice_date: '2026-02-06',
      due_date: '2026-02-20',
      currency_code: 'USD',
      client: {
        name: 'Blue Harbor Dental',
        address: '901 Harbor Ave',
      },
      invoice_charges: [
        {
          item_id: 'svc-bundle',
          description: 'Managed Services Bundle',
          quantity: 1,
          unit_price: 10000,
          total_price: 10000,
          recurring_detail_periods: [
            {
              service_period_start: '2026-01-01',
              service_period_end: '2026-02-01',
              billing_timing: 'arrears',
            },
            {
              service_period_start: '2026-02-01',
              service_period_end: '2026-03-01',
              billing_timing: 'arrears',
            },
          ],
        },
      ],
      subtotal: 10000,
      tax: 0,
      total: 10000,
    });

    expect(mapped).not.toBeNull();
    expect(mapped?.items[0]).toMatchObject({
      servicePeriodStart: '2026-01-01',
      servicePeriodEnd: '2026-03-01',
      billingTiming: 'arrears',
      recurringDetailPeriods: [
        {
          servicePeriodStart: '2026-01-01',
          servicePeriodEnd: '2026-02-01',
          billingTiming: 'arrears',
        },
        {
          servicePeriodStart: '2026-02-01',
          servicePeriodEnd: '2026-03-01',
          billingTiming: 'arrears',
        },
      ],
    });
  });

  it('T195: invoice rendering adapters flatten recurring summary ranges while preserving canonical detail periods for mixed timing detail rows', () => {
    const mapped = mapDbInvoiceToWasmViewModel({
      invoice_number: 'INV-604',
      invoice_date: '2026-02-06',
      due_date: '2026-02-20',
      currency_code: 'USD',
      client: {
        name: 'Blue Harbor Dental',
        address: '901 Harbor Ave',
      },
      invoice_charges: [
        {
          item_id: 'svc-bundle-mixed',
          description: 'Managed Services Bundle',
          quantity: 1,
          unit_price: 10000,
          total_price: 10000,
          recurring_detail_periods: [
            {
              service_period_start: '2026-01-01',
              service_period_end: '2026-02-01',
              billing_timing: 'arrears',
            },
            {
              service_period_start: '2026-02-01',
              service_period_end: '2026-03-01',
              billing_timing: 'advance',
            },
          ],
        },
      ],
      subtotal: 10000,
      tax: 0,
      total: 10000,
    });

    expect(mapped).not.toBeNull();
    expect(mapped?.items[0]).toMatchObject({
      servicePeriodStart: '2026-01-01',
      servicePeriodEnd: '2026-03-01',
      billingTiming: null,
      recurringDetailPeriods: [
        {
          servicePeriodStart: '2026-01-01',
          servicePeriodEnd: '2026-02-01',
          billingTiming: 'arrears',
        },
        {
          servicePeriodStart: '2026-02-01',
          servicePeriodEnd: '2026-03-01',
          billingTiming: 'advance',
        },
      ],
    });
  });
});

const snapshotSource = (
  overrides: Partial<InvoiceTimeCollectionSource> = {},
): InvoiceTimeCollectionSource => ({
  version: 2,
  rateKind: 'uniform',
  uniformRate: overrides.rate ?? 15000,
  entryId: 'entry-1',
  itemId: 'item-1',
  workItemType: 'ticket',
  workItemId: 'ticket-1',
  ticketNumber: 'T-001',
  title: 'Email outage',
  description: 'Mail flow failed.',
  entryDate: '2026-08-05',
  billedMinutes: 90,
  rate: 15000,
  netAmount: 22500,
  serviceId: 'svc-h',
  serviceName: 'Remote Support',
  ...overrides,
} as InvoiceTimeCollectionSource);

describe('buildInvoiceTimeCollections', () => {
  it('aggregates multiple entries on one ticket with integer minute/minor-unit sums', () => {
    const { ticketGroups, timeEntries } = buildInvoiceTimeCollections(
      [
        snapshotSource({ entryId: 'e2', entryDate: '2026-08-07', billedMinutes: 45, netAmount: 11250 }),
        snapshotSource({ entryId: 'e1' }),
      ],
    );

    expect(timeEntries.map((entry) => entry.id)).toEqual(['e1', 'e2']); // date-ordered
    expect(ticketGroups).toHaveLength(1);
    expect(ticketGroups[0]).toMatchObject({
      key: 'ticket:ticket-1',
      ticketNumber: 'T-001',
      title: 'Email outage',
      description: 'Mail flow failed.',
      label: 'T-001 — Email outage',
      dateStart: '2026-08-05',
      dateEnd: '2026-08-07',
      totalMinutes: 135,
      totalHours: 2.25,
      totalAmount: 33750,
      hasMixedRates: false,
      rate: 15000,
      rateDisplay: 15000,
      entryCount: 2,
    });
  });

  it('reports an explicit mixed-rate state instead of a blended rate', () => {
    const { ticketGroups } = buildInvoiceTimeCollections(
      [
        snapshotSource({ entryId: 'e1', rate: 12500, netAmount: 25000, billedMinutes: 120 }),
        snapshotSource({ entryId: 'e2', rate: 15000, netAmount: 7500, billedMinutes: 30 }),
      ],
    );

    expect(ticketGroups[0]).toMatchObject({
      hasMixedRates: true,
      rate: null,
      rateKind: 'mixed',
      rateDisplay: null,
      totalMinutes: 150,
      totalAmount: 32500,
    });
  });

  it('groups project-task time by task and ticketless time under the ad-hoc fallback', () => {
    const { ticketGroups } = buildInvoiceTimeCollections(
      [
        snapshotSource({
          entryId: 'e-task',
          workItemType: 'project_task',
          workItemId: 'task-1',
          ticketNumber: null,
          title: 'Data sync validation',
          description: null,
        }),
        snapshotSource({
          entryId: 'e-adhoc',
          workItemType: 'ad_hoc',
          workItemId: null,
          ticketNumber: null,
          title: null,
          description: null,
        }),
        snapshotSource({ entryId: 'e-ticket' }),
      ],
    );

    // Deterministic order: tickets, then tasks, then the ad-hoc group.
    expect(ticketGroups.map((group) => group.key)).toEqual([
      'ticket:ticket-1',
      'task:task-1',
      'ad_hoc',
    ]);
    expect(ticketGroups[1].label).toBe('Data sync validation');
    expect(ticketGroups[2].labelKey).toBe('time.other');
  });

  it('orders tickets deterministically by ticket number', () => {
    const { ticketGroups } = buildInvoiceTimeCollections(
      [
        snapshotSource({ entryId: 'e2', workItemId: 'ticket-b', ticketNumber: 'T-900' }),
        snapshotSource({ entryId: 'e1', workItemId: 'ticket-a', ticketNumber: 'T-100' }),
      ],
    );

    expect(ticketGroups.map((group) => group.ticketNumber)).toEqual(['T-100', 'T-900']);
  });
});

describe('mapDbInvoiceToWasmViewModel billed-time collections', () => {
  const baseInvoice = {
    invoice_number: 'INV-900',
    invoice_date: '2026-09-01',
    due_date: '2026-09-15',
    currency_code: 'USD',
    tax_source: 'internal',
    client: { name: 'EQUIT', address: '1 Foundry Rd' },
    subtotal: '37500',
    tax: '0',
    total: '37500',
  };

  it('builds timeEntries and ticketGroups from charge snapshots', () => {
    const mapped = mapDbInvoiceToWasmViewModel({
      ...baseInvoice,
      invoice_charges: [
        {
          item_id: 'item-1',
          description: 'Remote Support',
          quantity: '1.5',
          unit_price: '15000',
          net_amount: '22500',
          total_price: '22500',
          time_entry_snapshots: [snapshotSource({ itemId: undefined })],
        },
        {
          item_id: 'item-2',
          description: 'Remote Support',
          quantity: '1',
          unit_price: '15000',
          net_amount: '15000',
          total_price: '15000',
          time_entry_snapshots: [
            snapshotSource({ itemId: undefined, entryId: 'entry-2', entryDate: '2026-08-06', billedMinutes: 60, netAmount: 15000 }),
          ],
        },
      ],
    });

    expect(mapped?.timeEntries).toHaveLength(2);
    expect(mapped?.timeEntries?.[0]).toMatchObject({ id: 'entry-1', itemId: 'item-1' });
    expect(mapped?.ticketGroups).toHaveLength(1);
    expect(mapped?.ticketGroups?.[0]).toMatchObject({
      totalMinutes: 150,
      totalAmount: 37500,
    });
    // Canonical charge descriptions are untouched by the snapshot pipeline.
    expect(mapped?.items.map((item) => item.description)).toEqual([
      'Remote Support',
      'Remote Support',
    ]);
  });

  it('leaves the collections absent on legacy invoices without snapshots', () => {
    const mapped = mapDbInvoiceToWasmViewModel({
      ...baseInvoice,
      invoice_charges: [
        {
          item_id: 'item-1',
          description: 'Remote Support',
          quantity: '1.5',
          unit_price: '15000',
          total_price: '22500',
        },
      ],
    });

    expect(mapped).not.toBeNull();
    expect(mapped?.timeEntries).toBeUndefined();
    expect(mapped?.ticketGroups).toBeUndefined();
  });
});
