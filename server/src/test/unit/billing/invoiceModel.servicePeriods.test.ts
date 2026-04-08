import { describe, expect, it, vi } from 'vitest';

import Invoice from '@alga-psa/billing/models/invoice';

vi.mock('@alga-psa/formatting/avatarUtils', () => ({
  getClientLogoUrl: vi.fn(async () => null),
}));

type Row = Record<string, any>;

function normalizeColumn(column: string): string {
  return column.replace(/^.*\./, '');
}

function createQueryBuilder(rows: Row[]) {
  let resultRows = [...rows];

  const builder: any = {
    join: vi.fn().mockReturnThis(),
    leftJoin: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    where: vi.fn((columnOrCriteria: string | Record<string, any>, value?: any) => {
      if (typeof columnOrCriteria === 'string') {
        resultRows = resultRows.filter((row) => row[normalizeColumn(columnOrCriteria)] === value);
        return builder;
      }

      resultRows = resultRows.filter((row) =>
        Object.entries(columnOrCriteria).every(([key, expected]) => row[normalizeColumn(key)] === expected)
      );
      return builder;
    }),
    whereNull: vi.fn((column: string) => {
      resultRows = resultRows.filter((row) => row[normalizeColumn(column)] == null);
      return builder;
    }),
    whereIn: vi.fn((column: string, values: any[]) => {
      resultRows = resultRows.filter((row) => values.includes(row[normalizeColumn(column)]));
      return builder;
    }),
    orderBy: vi.fn((column: string, direction: 'asc' | 'desc' = 'asc') => {
      const normalizedColumn = normalizeColumn(column);
      resultRows.sort((left, right) => {
        const leftValue = left[normalizedColumn];
        const rightValue = right[normalizedColumn];
        if (leftValue === rightValue) {
          return 0;
        }
        if (leftValue == null) {
          return 1;
        }
        if (rightValue == null) {
          return -1;
        }
        return direction === 'desc'
          ? String(rightValue).localeCompare(String(leftValue))
          : String(leftValue).localeCompare(String(rightValue));
      });
      return builder;
    }),
    orderByRaw: vi.fn().mockReturnThis(),
    first: vi.fn(async () => resultRows[0]),
    then: (resolve: (value: Row[]) => unknown, reject?: (reason: unknown) => unknown) =>
      Promise.resolve(resultRows).then(resolve, reject),
  };

  return builder;
}

function createMockKnex(tables: Record<string, Row[]>) {
  const knex: any = vi.fn((tableName: string) => {
    const normalizedTableName = tableName.split(/\s+as\s+/i)[0].trim();
    return createQueryBuilder(tables[normalizedTableName] ?? []);
  });
  knex.raw = vi.fn((sql: string) => sql);

  return knex;
}

describe('invoice model recurring service-period projection', () => {
  it('T075: invoice detail readers preserve canonical recurring periods without coupling manual lines to them', async () => {
    const knex = createMockKnex({
      invoices: [
        {
          invoice_id: 'invoice-1',
          tenant: 'tenant-1',
          client_id: 'client-1',
          credit_applied: 0,
          total_amount: 7500,
        },
      ],
      invoice_charges: [
        {
          item_id: 'recurring-1',
          invoice_id: 'invoice-1',
          tenant: 'tenant-1',
          service_id: 'service-1',
          description: 'Managed Router',
          quantity: 1,
          unit_price: 5000,
          total_price: 5000,
          tax_amount: 0,
          net_amount: 5000,
          is_manual: false,
        },
        {
          item_id: 'manual-1',
          invoice_id: 'invoice-1',
          tenant: 'tenant-1',
          service_id: null,
          description: 'Goodwill adjustment',
          quantity: 1,
          unit_price: -2500,
          total_price: -2500,
          tax_amount: 0,
          net_amount: -2500,
          is_manual: true,
          is_discount: true,
        },
      ],
      invoice_charge_details: [
        {
          item_id: 'recurring-1',
          tenant: 'tenant-1',
          service_period_start: '2025-01-01T00:00:00.000Z',
          service_period_end: '2025-02-01T00:00:00.000Z',
          billing_timing: 'arrears',
        },
      ],
    });

    const invoice = await Invoice.getById(knex, 'tenant-1', 'invoice-1');

    expect(invoice?.invoice_charges).toHaveLength(2);

    const recurringCharge = invoice?.invoice_charges?.find((charge) => charge.item_id === 'recurring-1');
    const manualCharge = invoice?.invoice_charges?.find((charge) => charge.item_id === 'manual-1');

    expect(recurringCharge).toMatchObject({
      item_id: 'recurring-1',
      is_manual: false,
      service_period_start: '2025-01-01T00:00:00.000Z',
      service_period_end: '2025-02-01T00:00:00.000Z',
      billing_timing: 'arrears',
    });
    expect(manualCharge).toMatchObject({
      item_id: 'manual-1',
      is_manual: true,
    });
    expect(manualCharge).not.toHaveProperty('service_period_start');
    expect(manualCharge).not.toHaveProperty('service_period_end');
    expect(manualCharge).not.toHaveProperty('billing_timing');
  });

  it('T090: invoice detail readers used by dashboard dialogs keep recurring ordering and canonical metadata stable', async () => {
    const knex = createMockKnex({
      invoice_charges: [
        {
          item_id: 'manual-1',
          invoice_id: 'invoice-1',
          tenant: 'tenant-1',
          service_id: null,
          description: 'Manual adjustment',
          quantity: 1,
          unit_price: -1000,
          total_price: -1000,
          tax_amount: 0,
          net_amount: -1000,
          is_manual: true,
        },
        {
          item_id: 'recurring-feb',
          invoice_id: 'invoice-1',
          tenant: 'tenant-1',
          service_id: 'service-2',
          description: 'Managed Firewall',
          quantity: 1,
          unit_price: 5000,
          total_price: 5000,
          tax_amount: 0,
          net_amount: 5000,
          is_manual: false,
        },
        {
          item_id: 'recurring-jan',
          invoice_id: 'invoice-1',
          tenant: 'tenant-1',
          service_id: 'service-1',
          description: 'Managed Router',
          quantity: 1,
          unit_price: 5000,
          total_price: 5000,
          tax_amount: 0,
          net_amount: 5000,
          is_manual: false,
        },
      ],
      invoice_charge_details: [
        {
          item_id: 'recurring-feb',
          tenant: 'tenant-1',
          service_period_start: '2025-02-01T00:00:00.000Z',
          service_period_end: '2025-03-01T00:00:00.000Z',
          billing_timing: 'arrears',
        },
        {
          item_id: 'recurring-jan',
          tenant: 'tenant-1',
          service_period_start: '2025-01-01T00:00:00.000Z',
          service_period_end: '2025-02-01T00:00:00.000Z',
          billing_timing: 'arrears',
        },
      ],
    });

    const items = await Invoice.getInvoiceItems(knex, 'tenant-1', 'invoice-1');

    expect(items.map((item) => item.item_id)).toEqual([
      'recurring-jan',
      'recurring-feb',
      'manual-1',
    ]);
    expect(items[0]).toMatchObject({
      service_period_start: '2025-01-01T00:00:00.000Z',
      service_period_end: '2025-02-01T00:00:00.000Z',
      billing_timing: 'arrears',
      recurring_detail_periods: [
        {
          service_period_start: '2025-01-01T00:00:00.000Z',
          service_period_end: '2025-02-01T00:00:00.000Z',
          billing_timing: 'arrears',
        },
      ],
    });
    expect(items[2]).not.toHaveProperty('recurring_detail_periods');
  });

  it('T191: a recurring parent charge can summarize multiple canonical detail periods while preserving the authoritative detail rows', async () => {
    const knex = createMockKnex({
      invoices: [
        {
          invoice_id: 'invoice-1',
          tenant: 'tenant-1',
          client_id: 'client-1',
          credit_applied: 0,
          total_amount: 10000,
        },
      ],
      invoice_charges: [
        {
          item_id: 'recurring-1',
          invoice_id: 'invoice-1',
          tenant: 'tenant-1',
          service_id: 'service-1',
          description: 'Managed Services Bundle',
          quantity: 1,
          unit_price: 10000,
          total_price: 10000,
          tax_amount: 0,
          net_amount: 10000,
          is_manual: false,
        },
      ],
      invoice_charge_details: [
        {
          item_id: 'recurring-1',
          tenant: 'tenant-1',
          service_period_start: '2025-01-01T00:00:00.000Z',
          service_period_end: '2025-02-01T00:00:00.000Z',
          billing_timing: 'arrears',
        },
        {
          item_id: 'recurring-1',
          tenant: 'tenant-1',
          service_period_start: '2025-02-01T00:00:00.000Z',
          service_period_end: '2025-03-01T00:00:00.000Z',
          billing_timing: 'advance',
        },
      ],
    });

    const invoice = await Invoice.getById(knex, 'tenant-1', 'invoice-1');
    const recurringCharge = invoice?.invoice_charges?.[0];

    expect(recurringCharge).toMatchObject({
      item_id: 'recurring-1',
      service_period_start: '2025-01-01T00:00:00.000Z',
      service_period_end: '2025-03-01T00:00:00.000Z',
      billing_timing: null,
      recurring_detail_periods: [
        {
          service_period_start: '2025-01-01T00:00:00.000Z',
          service_period_end: '2025-02-01T00:00:00.000Z',
          billing_timing: 'arrears',
        },
        {
          service_period_start: '2025-02-01T00:00:00.000Z',
          service_period_end: '2025-03-01T00:00:00.000Z',
          billing_timing: 'advance',
        },
      ],
    });
    expect(recurringCharge).not.toHaveProperty('recurring_projection');
  });

  it('T200: hydrated recurring charges expose canonical detail periods as authoritative while parent period fields stay summary metadata', async () => {
    const knex = createMockKnex({
      invoices: [
        {
          invoice_id: 'invoice-1',
          tenant: 'tenant-1',
          client_id: 'client-1',
          credit_applied: 0,
          total_amount: 10000,
        },
      ],
      invoice_charges: [
        {
          item_id: 'recurring-1',
          invoice_id: 'invoice-1',
          tenant: 'tenant-1',
          service_id: 'service-1',
          description: 'Managed Services Bundle',
          quantity: 1,
          unit_price: 10000,
          total_price: 10000,
          tax_amount: 0,
          net_amount: 10000,
          is_manual: false,
          // Legacy/header-like grouping values that should be replaced by canonical detail hydration.
          service_period_start: '2024-12-15T00:00:00.000Z',
          service_period_end: '2025-02-15T00:00:00.000Z',
          billing_timing: 'arrears',
        },
      ],
      invoice_charge_details: [
        {
          item_id: 'recurring-1',
          tenant: 'tenant-1',
          service_period_start: '2025-01-01T00:00:00.000Z',
          service_period_end: '2025-02-01T00:00:00.000Z',
          billing_timing: 'arrears',
        },
        {
          item_id: 'recurring-1',
          tenant: 'tenant-1',
          service_period_start: '2025-02-01T00:00:00.000Z',
          service_period_end: '2025-03-01T00:00:00.000Z',
          billing_timing: 'advance',
        },
      ],
    });

    const invoice = await Invoice.getById(knex, 'tenant-1', 'invoice-1');
    const recurringCharge = invoice?.invoice_charges?.[0];

    expect(recurringCharge?.recurring_detail_periods).toEqual([
      {
        service_period_start: '2025-01-01T00:00:00.000Z',
        service_period_end: '2025-02-01T00:00:00.000Z',
        billing_timing: 'arrears',
      },
      {
        service_period_start: '2025-02-01T00:00:00.000Z',
        service_period_end: '2025-03-01T00:00:00.000Z',
        billing_timing: 'advance',
      },
    ]);
    expect(recurringCharge?.service_period_start).toBe('2025-01-01T00:00:00.000Z');
    expect(recurringCharge?.service_period_end).toBe('2025-03-01T00:00:00.000Z');
    expect(recurringCharge?.billing_timing).toBeNull();
    expect(recurringCharge).not.toHaveProperty('recurring_projection');
  });

  it('T192: historical flat invoices without canonical detail rows still hydrate without synthesized recurring detail metadata', async () => {
    const knex = createMockKnex({
      invoices: [
        {
          invoice_id: 'invoice-legacy',
          tenant: 'tenant-1',
          client_id: 'client-1',
          credit_applied: 0,
          total_amount: 5000,
        },
      ],
      invoice_charges: [
        {
          item_id: 'legacy-1',
          invoice_id: 'invoice-legacy',
          tenant: 'tenant-1',
          service_id: 'service-legacy',
          description: 'Legacy Managed Service',
          quantity: 1,
          unit_price: 5000,
          total_price: 5000,
          tax_amount: 0,
          net_amount: 5000,
          is_manual: false,
        },
      ],
      invoice_charge_details: [],
    });

    const invoice = await Invoice.getById(knex, 'tenant-1', 'invoice-legacy');
    const legacyCharge = invoice?.invoice_charges?.[0];

    expect(legacyCharge).toMatchObject({
      item_id: 'legacy-1',
      description: 'Legacy Managed Service',
      quantity: 1,
      total_price: 5000,
    });
    expect(legacyCharge).not.toHaveProperty('recurring_detail_periods');
    expect(legacyCharge).not.toHaveProperty('service_period_start');
    expect(legacyCharge).not.toHaveProperty('service_period_end');
    expect(legacyCharge).not.toHaveProperty('billing_timing');
  });

  it('T096: prepayment-applied recurring invoice rereads canonical detail service periods', async () => {
    const knex = createMockKnex({
      invoices: [
        {
          invoice_id: 'invoice-1',
          tenant: 'tenant-1',
          client_id: 'client-1',
          credit_applied: 2500,
          total_amount: 0,
        },
      ],
      invoice_charges: [
        {
          item_id: 'item-1',
          invoice_id: 'invoice-1',
          tenant: 'tenant-1',
          service_id: 'service-1',
          description: 'Managed Router',
          quantity: 1,
          unit_price: 10000,
          total_price: 10000,
          tax_amount: 0,
          net_amount: 10000,
          is_manual: false,
        },
      ],
      invoice_charge_details: [
        {
          item_id: 'item-1',
          tenant: 'tenant-1',
          service_period_start: '2025-01-01T00:00:00.000Z',
          service_period_end: '2025-02-01T00:00:00.000Z',
          billing_timing: 'arrears',
        },
      ],
    });

    const invoice = await Invoice.getById(knex, 'tenant-1', 'invoice-1');

    expect(invoice?.credit_applied).toBe(2500);
    expect(invoice?.invoice_charges).toEqual([
      expect.objectContaining({
        item_id: 'item-1',
        service_period_start: '2025-01-01T00:00:00.000Z',
        service_period_end: '2025-02-01T00:00:00.000Z',
        billing_timing: 'arrears',
      }),
    ]);
  });

  it('T097: recurring invoice rereads remain stable across multiple prepayment-applied cycles', async () => {
    const knex = createMockKnex({
      invoices: [
        {
          invoice_id: 'invoice-1',
          tenant: 'tenant-1',
          client_id: 'client-1',
          credit_applied: 4000,
          total_amount: 0,
        },
        {
          invoice_id: 'invoice-2',
          tenant: 'tenant-1',
          client_id: 'client-1',
          credit_applied: 1000,
          total_amount: 2500,
        },
      ],
      invoice_charges: [
        {
          item_id: 'item-1',
          invoice_id: 'invoice-1',
          tenant: 'tenant-1',
          service_id: 'service-1',
          description: 'Managed Router',
          quantity: 1,
          unit_price: 4000,
          total_price: 4000,
          tax_amount: 0,
          net_amount: 4000,
          is_manual: false,
        },
        {
          item_id: 'item-2',
          invoice_id: 'invoice-2',
          tenant: 'tenant-1',
          service_id: 'service-1',
          description: 'Managed Router',
          quantity: 1,
          unit_price: 3500,
          total_price: 3500,
          tax_amount: 0,
          net_amount: 3500,
          is_manual: false,
        },
      ],
      invoice_charge_details: [
        {
          item_id: 'item-1',
          tenant: 'tenant-1',
          service_period_start: '2025-01-01T00:00:00.000Z',
          service_period_end: '2025-02-01T00:00:00.000Z',
          billing_timing: 'arrears',
        },
        {
          item_id: 'item-2',
          tenant: 'tenant-1',
          service_period_start: '2025-02-01T00:00:00.000Z',
          service_period_end: '2025-03-01T00:00:00.000Z',
          billing_timing: 'arrears',
        },
      ],
    });

    const januaryInvoice = await Invoice.getById(knex, 'tenant-1', 'invoice-1');
    const februaryInvoice = await Invoice.getById(knex, 'tenant-1', 'invoice-2');

    expect(januaryInvoice?.invoice_charges?.[0]).toMatchObject({
      item_id: 'item-1',
      service_period_start: '2025-01-01T00:00:00.000Z',
      service_period_end: '2025-02-01T00:00:00.000Z',
      billing_timing: 'arrears',
    });
    expect(februaryInvoice?.invoice_charges?.[0]).toMatchObject({
      item_id: 'item-2',
      service_period_start: '2025-02-01T00:00:00.000Z',
      service_period_end: '2025-03-01T00:00:00.000Z',
      billing_timing: 'arrears',
    });
  });

  it('T080: canonical recurring service-period metadata remains stable through invoice reload and reread paths', async () => {
    const knex = createMockKnex({
      invoices: [
        {
          invoice_id: 'invoice-1',
          tenant: 'tenant-1',
          client_id: 'client-1',
          credit_applied: 0,
          subtotal: 7000,
          tax: 0,
          total_amount: 7000,
          invoice_number: 'INV-001',
          invoice_date: '2025-03-01T00:00:00.000Z',
          due_date: '2025-03-15T00:00:00.000Z',
          status: 'draft',
          currency_code: 'USD',
          is_manual: false,
          tax_source: 'internal',
          finalized_at: null,
          billing_cycle_id: 'cycle-1',
        },
      ],
      invoice_charges: [
        {
          item_id: 'recurring-1',
          invoice_id: 'invoice-1',
          tenant: 'tenant-1',
          service_id: 'service-1',
          description: 'Managed Router',
          quantity: 1,
          unit_price: 7000,
          total_price: 7000,
          tax_amount: 0,
          net_amount: 7000,
          is_manual: false,
        },
      ],
      invoice_charge_details: [
        {
          item_id: 'recurring-1',
          tenant: 'tenant-1',
          service_period_start: '2025-01-01T00:00:00.000Z',
          service_period_end: '2025-02-01T00:00:00.000Z',
          billing_timing: 'arrears',
        },
        {
          item_id: 'recurring-1',
          tenant: 'tenant-1',
          service_period_start: '2025-02-01T00:00:00.000Z',
          service_period_end: '2025-03-01T00:00:00.000Z',
          billing_timing: 'arrears',
        },
      ],
      recurring_service_periods: [
        {
          tenant: 'tenant-1',
          invoice_id: 'invoice-1',
          service_period_start: new Date('2025-01-01T00:00:00.000Z'),
          service_period_end: new Date('2025-02-01T00:00:00.000Z'),
          invoice_window_start: new Date('2025-02-01T00:00:00.000Z'),
          invoice_window_end: new Date('2025-03-01T00:00:00.000Z'),
          cadence_owner: 'client',
        },
        {
          tenant: 'tenant-1',
          invoice_id: 'invoice-1',
          service_period_start: new Date('2025-02-01T00:00:00.000Z'),
          service_period_end: new Date('2025-03-01T00:00:00.000Z'),
          invoice_window_start: new Date('2025-02-01T00:00:00.000Z'),
          invoice_window_end: new Date('2025-03-01T00:00:00.000Z'),
          cadence_owner: 'client',
        },
      ],
      clients: [
        {
          client_id: 'client-1',
          tenant: 'tenant-1',
          client_name: 'Client One',
          properties: '{}',
        },
      ],
      contacts: [
        {
          client_id: 'client-1',
          tenant: 'tenant-1',
          full_name: 'Billing Contact',
        },
      ],
      tenant_companies: [],
      tenants: [
        {
          tenant: 'tenant-1',
          client_name: 'Tenant Co',
        },
      ],
    });

    const firstRead = await Invoice.getById(knex, 'tenant-1', 'invoice-1');
    const fullRead = await Invoice.getFullInvoiceById(knex, 'tenant-1', 'invoice-1');
    const secondRead = await Invoice.getById(knex, 'tenant-1', 'invoice-1');

    for (const charge of [
      firstRead?.invoice_charges?.[0],
      fullRead?.invoice_charges?.[0],
      secondRead?.invoice_charges?.[0],
    ]) {
      expect(charge).toMatchObject({
        item_id: 'recurring-1',
        service_period_start: '2025-01-01T00:00:00.000Z',
        service_period_end: '2025-03-01T00:00:00.000Z',
        billing_timing: 'arrears',
      });
    }

    expect(fullRead).toMatchObject({
      recurring_service_period_start: '2025-01-01',
      recurring_service_period_end: '2025-03-01',
      recurring_invoice_window_start: '2025-02-01',
      recurring_invoice_window_end: '2025-03-01',
      recurring_execution_window_kind: 'client_cadence_window',
      recurring_cadence_source: 'client_schedule',
    });
  });

  it('T091: partially credit-applied recurring invoices keep canonical detail periods on reread', async () => {
    const knex = createMockKnex({
      invoices: [
        {
          invoice_id: 'invoice-1',
          tenant: 'tenant-1',
          client_id: 'client-1',
          credit_applied: 1500,
          total_amount: 3500,
        },
      ],
      invoice_charges: [
        {
          item_id: 'item-1',
          invoice_id: 'invoice-1',
          tenant: 'tenant-1',
          service_id: 'service-1',
          description: 'Managed Firewall',
          quantity: 1,
          unit_price: 5000,
          total_price: 5000,
          tax_amount: 0,
          net_amount: 5000,
          is_manual: false,
        },
      ],
      invoice_charge_details: [
        {
          item_id: 'item-1',
          tenant: 'tenant-1',
          service_period_start: '2025-03-01T00:00:00.000Z',
          service_period_end: '2025-04-01T00:00:00.000Z',
          billing_timing: 'arrears',
        },
      ],
    });

    const invoice = await Invoice.getById(knex, 'tenant-1', 'invoice-1');

    expect(invoice?.credit_applied).toBe(1500);
    expect(invoice?.total_amount).toBe(3500);
    expect(invoice?.invoice_charges).toEqual([
      expect.objectContaining({
        item_id: 'item-1',
        service_period_start: '2025-03-01T00:00:00.000Z',
        service_period_end: '2025-04-01T00:00:00.000Z',
        billing_timing: 'arrears',
      }),
    ]);
  });

  it('T094: negative recurring invoices keep canonical service periods on reread', async () => {
    const knex = createMockKnex({
      invoices: [
        {
          invoice_id: 'invoice-1',
          tenant: 'tenant-1',
          client_id: 'client-1',
          credit_applied: 0,
          total_amount: -2500,
        },
      ],
      invoice_charges: [
        {
          item_id: 'item-1',
          invoice_id: 'invoice-1',
          tenant: 'tenant-1',
          service_id: 'service-1',
          description: 'Service credit true-up',
          quantity: 1,
          unit_price: -2500,
          total_price: -2500,
          tax_amount: 0,
          net_amount: -2500,
          is_manual: false,
        },
      ],
      invoice_charge_details: [
        {
          item_id: 'item-1',
          tenant: 'tenant-1',
          service_period_start: '2025-01-01T00:00:00.000Z',
          service_period_end: '2025-02-01T00:00:00.000Z',
          billing_timing: 'arrears',
        },
      ],
    });

    const invoice = await Invoice.getById(knex, 'tenant-1', 'invoice-1');

    expect(invoice?.total_amount).toBe(-2500);
    expect(invoice?.invoice_charges).toEqual([
      expect.objectContaining({
        item_id: 'item-1',
        total_price: -2500,
        net_amount: -2500,
        service_period_start: '2025-01-01T00:00:00.000Z',
        service_period_end: '2025-02-01T00:00:00.000Z',
        billing_timing: 'arrears',
      }),
    ]);
  });

  it('T095: negative recurring credit sources and follow-on credit-applied invoices both preserve canonical periods', async () => {
    const knex = createMockKnex({
      invoices: [
        {
          invoice_id: 'invoice-negative',
          tenant: 'tenant-1',
          client_id: 'client-1',
          credit_applied: 0,
          total_amount: -11000,
        },
        {
          invoice_id: 'invoice-positive',
          tenant: 'tenant-1',
          client_id: 'client-1',
          credit_applied: 11000,
          total_amount: 0,
        },
      ],
      invoice_charges: [
        {
          item_id: 'item-negative',
          invoice_id: 'invoice-negative',
          tenant: 'tenant-1',
          service_id: 'service-credit',
          description: 'January service credit',
          quantity: 1,
          unit_price: -11000,
          total_price: -11000,
          tax_amount: 0,
          net_amount: -11000,
          is_manual: false,
        },
        {
          item_id: 'item-positive',
          invoice_id: 'invoice-positive',
          tenant: 'tenant-1',
          service_id: 'service-regular',
          description: 'February managed service',
          quantity: 1,
          unit_price: 11000,
          total_price: 11000,
          tax_amount: 0,
          net_amount: 11000,
          is_manual: false,
        },
      ],
      invoice_charge_details: [
        {
          item_id: 'item-negative',
          tenant: 'tenant-1',
          service_period_start: '2025-01-01T00:00:00.000Z',
          service_period_end: '2025-02-01T00:00:00.000Z',
          billing_timing: 'arrears',
        },
        {
          item_id: 'item-positive',
          tenant: 'tenant-1',
          service_period_start: '2025-02-01T00:00:00.000Z',
          service_period_end: '2025-03-01T00:00:00.000Z',
          billing_timing: 'arrears',
        },
      ],
    });

    const negativeInvoice = await Invoice.getById(knex, 'tenant-1', 'invoice-negative');
    const positiveInvoice = await Invoice.getById(knex, 'tenant-1', 'invoice-positive');

    expect(negativeInvoice?.invoice_charges).toEqual([
      expect.objectContaining({
        item_id: 'item-negative',
        service_period_start: '2025-01-01T00:00:00.000Z',
        service_period_end: '2025-02-01T00:00:00.000Z',
        billing_timing: 'arrears',
      }),
    ]);
    expect(positiveInvoice?.credit_applied).toBe(11000);
    expect(positiveInvoice?.invoice_charges).toEqual([
      expect.objectContaining({
        item_id: 'item-positive',
        service_period_start: '2025-02-01T00:00:00.000Z',
        service_period_end: '2025-03-01T00:00:00.000Z',
        billing_timing: 'arrears',
      }),
    ]);
  });
});
