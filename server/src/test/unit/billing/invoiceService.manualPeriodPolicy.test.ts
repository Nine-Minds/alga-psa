import { describe, expect, it } from 'vitest';

import { persistManualInvoiceCharges } from '../../../../../packages/billing/src/services/invoiceService';

function createMockTx() {
  const inserts: Record<string, any[]> = {
    invoice_charges: [],
    service_catalog: [],
    tax_rates: [],
  };

  const tx: any = (tableName: string) => ({
    where: () => ({
      select: () => ({
        first: async () => null,
      }),
      first: async () => null,
    }),
    insert: async (payload: any) => {
      inserts[tableName].push(payload);
      return [payload];
    },
  });

  return { tx, inserts };
}

describe('manual invoice service-period policy', () => {
  it('T211: manually entered invoice lines remain intentionally periodless instead of creating canonical recurring service-period records', async () => {
    const { tx, inserts } = createMockTx();

    const subtotal = await persistManualInvoiceCharges(
      tx,
      'invoice-1',
      [
        {
          description: 'Manual adjustment',
          quantity: 1,
          rate: 2500,
          is_discount: false,
        },
        {
          description: 'Courtesy discount',
          quantity: 1,
          rate: 0,
          is_discount: true,
          discount_type: 'percentage',
          discount_percentage: 10,
        },
      ] as any,
      {
        client_id: 'client-1',
        region_code: 'US-WA',
      },
      {
        user: {
          id: 'user-1',
        },
      } as any,
      'tenant-1',
    );

    expect(subtotal).toBe(2250);
    expect(inserts.invoice_charges).toHaveLength(2);
    expect(inserts.invoice_charges[0]).toMatchObject({
      invoice_id: 'invoice-1',
      description: 'Manual adjustment',
      is_manual: true,
      is_discount: false,
      net_amount: 2500,
    });
    expect(inserts.invoice_charges[0]).not.toHaveProperty('service_period_start');
    expect(inserts.invoice_charges[0]).not.toHaveProperty('service_period_end');
    expect(inserts.invoice_charges[0]).not.toHaveProperty('billing_timing');
    expect(inserts.invoice_charges[1]).toMatchObject({
      description: 'Courtesy discount',
      is_manual: true,
      is_discount: true,
      discount_type: 'percentage',
      discount_percentage: 10,
      net_amount: -250,
    });
    expect(inserts.invoice_charges[1]).not.toHaveProperty('service_period_start');
    expect(inserts.invoice_charges[1]).not.toHaveProperty('service_period_end');
    expect(inserts.invoice_charges[1]).not.toHaveProperty('billing_timing');
  });
});
