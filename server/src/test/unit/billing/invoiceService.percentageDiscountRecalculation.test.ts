import { describe, expect, it } from 'vitest';

import {
  recalculatePercentageDiscountInvoiceCharges,
  updateInvoiceTotalsAndRecordTransaction,
} from '../../../../../packages/billing/src/services/invoiceService';

type Row = Record<string, any>;

function createMockTx() {
  const tables: Record<string, Row[]> = {
    invoices: [
      {
        invoice_id: 'invoice-1',
        tenant: 'tenant-1',
        invoice_number: 'INV-1001',
        subtotal: 0,
        tax: 0,
        total_amount: 0,
      },
    ],
    invoice_charges: [
      {
        item_id: 'recurring-1',
        invoice_id: 'invoice-1',
        tenant: 'tenant-1',
        is_manual: false,
        is_discount: false,
        net_amount: 10000,
        tax_amount: 0,
        total_price: 10000,
        service_period_start: '2025-01-01T00:00:00.000Z',
        service_period_end: '2025-02-01T00:00:00.000Z',
        billing_timing: 'arrears',
      },
      {
        item_id: 'manual-1',
        invoice_id: 'invoice-1',
        tenant: 'tenant-1',
        is_manual: true,
        is_discount: false,
        net_amount: 2000,
        tax_amount: 0,
        total_price: 2000,
      },
      {
        item_id: 'discount-1',
        invoice_id: 'invoice-1',
        tenant: 'tenant-1',
        is_manual: true,
        is_discount: true,
        discount_type: 'percentage',
        discount_percentage: 10,
        applies_to_item_id: null,
        net_amount: -500,
        tax_amount: 0,
        total_price: -500,
      },
    ],
    transactions: [],
  };

  const tx = ((tableName: string) => {
    let rows = tables[tableName] ?? [];
    let filteredRows = rows;

    const builder: any = {
      where(criteria: Record<string, any>) {
        filteredRows = filteredRows.filter((row) =>
          Object.entries(criteria).every(([key, expected]) => row[key] === expected),
        );
        return builder;
      },
      select() {
        return builder;
      },
      orderBy(column: string, direction: 'asc' | 'desc' = 'asc') {
        filteredRows = [...filteredRows].sort((left, right) => {
          const leftValue = left[column];
          const rightValue = right[column];
          if (leftValue === rightValue) {
            return 0;
          }
          if (leftValue == null) {
            return direction === 'asc' ? -1 : 1;
          }
          if (rightValue == null) {
            return direction === 'asc' ? 1 : -1;
          }
          return direction === 'asc'
            ? String(leftValue).localeCompare(String(rightValue))
            : String(rightValue).localeCompare(String(leftValue));
        });
        return builder;
      },
      sum(_expression: string) {
        const totalTax = filteredRows.reduce(
          (sum, row) => sum + Number(row.tax_amount || 0),
          0,
        );
        filteredRows = [{ totalTax }];
        return builder;
      },
      async first() {
        return filteredRows[0] ?? null;
      },
      async update(payload: Record<string, any>) {
        let updated = 0;
        rows.forEach((row) => {
          if (filteredRows.includes(row)) {
            Object.assign(row, payload);
            updated += 1;
          }
        });
        return updated;
      },
      async insert(payload: Record<string, any>) {
        rows.push(payload);
        return [payload];
      },
      then(onFulfilled: (value: Row[]) => unknown, onRejected?: (reason: unknown) => unknown) {
        return Promise.resolve(filteredRows).then(onFulfilled, onRejected);
      },
    };

    return builder;
  }) as any;

  return { tx, tables };
}

describe('invoiceService percentage discount recalculation', () => {
  it('T209: percentage discounts recompute from the current non-discount subtotal and keep recurring line provenance intact during net-total recalculation', async () => {
    const { tx, tables } = createMockTx();

    const normalizedItems = await recalculatePercentageDiscountInvoiceCharges(
      tx,
      'invoice-1',
      'tenant-1',
    );

    expect(
      normalizedItems.find((item) => item.item_id === 'discount-1')?.net_amount,
    ).toBe(-1200);
    expect(
      tables.invoice_charges.find((item) => item.item_id === 'discount-1'),
    ).toMatchObject({
      net_amount: -1200,
      total_price: -1200,
    });
    expect(
      tables.invoice_charges.find((item) => item.item_id === 'recurring-1'),
    ).toMatchObject({
      service_period_start: '2025-01-01T00:00:00.000Z',
      service_period_end: '2025-02-01T00:00:00.000Z',
      billing_timing: 'arrears',
    });

    await updateInvoiceTotalsAndRecordTransaction(
      tx,
      'invoice-1',
      { client_id: 'client-1' },
      'tenant-1',
      'INV-1001',
    );

    expect(tables.invoices[0]).toMatchObject({
      subtotal: 10800,
      tax: 0,
      total_amount: 10800,
    });
    expect(tables.transactions).toHaveLength(1);
    expect(tables.transactions[0]).toMatchObject({
      invoice_id: 'invoice-1',
      amount: 10800,
      type: 'invoice_generated',
      description: 'Generated invoice INV-1001',
    });
  });
});
