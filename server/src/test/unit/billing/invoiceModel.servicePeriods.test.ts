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
});
