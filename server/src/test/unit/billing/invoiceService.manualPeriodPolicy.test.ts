import { describe, expect, it } from 'vitest';

import { persistManualInvoiceCharges } from '../../../../../packages/billing/src/services/invoiceService';

function createMockTx(existingInvoiceCharges: Array<Record<string, any>> = []) {
  const inserts: Record<string, any[]> = {
    invoice_charges: [],
    service_catalog: [],
    tax_rates: [],
  };

  const tx: any = (tableName: string) => ({
    where: (criteria: Record<string, any>) => ({
      select: () => ({
        first: async () => null,
      }),
      first: async () => {
        if (tableName !== 'invoice_charges') {
          return null;
        }

        return existingInvoiceCharges.find((row) =>
          Object.entries(criteria).every(([key, expected]) => row[key] === expected),
        ) ?? null;
      },
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

  it('T213: manual lines can keep advisory provenance to an existing recurring parent charge without becoming canonical recurring period rows', async () => {
    const { tx, inserts } = createMockTx([
      {
        item_id: 'recurring-1',
        invoice_id: 'invoice-1',
        tenant: 'tenant-1',
        net_amount: 10000,
        service_period_start: '2025-01-01T00:00:00.000Z',
        service_period_end: '2025-02-01T00:00:00.000Z',
        billing_timing: 'arrears',
      },
    ]);

    const subtotal = await persistManualInvoiceCharges(
      tx,
      'invoice-1',
      [
        {
          description: 'Recurring-line courtesy credit',
          quantity: 1,
          rate: 0,
          is_discount: true,
          discount_type: 'percentage',
          discount_percentage: 10,
          applies_to_item_id: 'recurring-1',
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

    expect(subtotal).toBe(-1000);
    expect(inserts.invoice_charges).toHaveLength(1);
    expect(inserts.invoice_charges[0]).toMatchObject({
      description: 'Recurring-line courtesy credit',
      is_manual: true,
      is_discount: true,
      applies_to_item_id: 'recurring-1',
      discount_type: 'percentage',
      discount_percentage: 10,
      net_amount: -1000,
    });
    expect(inserts.invoice_charges[0]).not.toHaveProperty('service_period_start');
    expect(inserts.invoice_charges[0]).not.toHaveProperty('service_period_end');
    expect(inserts.invoice_charges[0]).not.toHaveProperty('billing_timing');
  });

  it('T212: manual and recurring charges can coexist on one invoice without corrupting canonical recurring detail semantics', async () => {
    const existingRecurringCharge = {
      item_id: 'recurring-1',
      invoice_id: 'invoice-1',
      tenant: 'tenant-1',
      net_amount: 10000,
      service_period_start: '2025-01-01T00:00:00.000Z',
      service_period_end: '2025-02-01T00:00:00.000Z',
      billing_timing: 'arrears',
    };
    const { tx, inserts } = createMockTx([existingRecurringCharge]);

    const subtotal = await persistManualInvoiceCharges(
      tx,
      'invoice-1',
      [
        {
          description: 'One-time onsite surcharge',
          quantity: 1,
          rate: 2500,
          is_discount: false,
        },
        {
          description: 'Recurring-line courtesy credit',
          quantity: 1,
          rate: 0,
          is_discount: true,
          discount_type: 'percentage',
          discount_percentage: 10,
          applies_to_item_id: 'recurring-1',
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

    expect(subtotal).toBe(1500);
    expect(existingRecurringCharge).toMatchObject({
      service_period_start: '2025-01-01T00:00:00.000Z',
      service_period_end: '2025-02-01T00:00:00.000Z',
      billing_timing: 'arrears',
    });
    expect(inserts.invoice_charges).toEqual([
      expect.objectContaining({
        description: 'One-time onsite surcharge',
        is_manual: true,
        is_discount: false,
        net_amount: 2500,
      }),
      expect.objectContaining({
        description: 'Recurring-line courtesy credit',
        is_manual: true,
        is_discount: true,
        applies_to_item_id: 'recurring-1',
        net_amount: -1000,
      }),
    ]);
    expect(inserts.invoice_charges[0]).not.toHaveProperty('service_period_start');
    expect(inserts.invoice_charges[0]).not.toHaveProperty('service_period_end');
    expect(inserts.invoice_charges[0]).not.toHaveProperty('billing_timing');
    expect(inserts.invoice_charges[1]).not.toHaveProperty('service_period_start');
    expect(inserts.invoice_charges[1]).not.toHaveProperty('service_period_end');
    expect(inserts.invoice_charges[1]).not.toHaveProperty('billing_timing');
  });
});
