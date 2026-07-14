import { describe, expect, it } from 'vitest';

import {
  persistManualInvoiceCharges,
  validateClientBillingEmail,
} from '../../../../../packages/billing/src/services/invoiceService';

function normalizeColumnName(columnName: string) {
  const [, unqualifiedName] = columnName.match(/^(?:[^.]+)\.(.+)$/) ?? [];
  return unqualifiedName ?? columnName;
}

function createMockTx(existingInvoiceCharges: Array<Record<string, any>> = []) {
  const inserts: Record<string, any[]> = {
    invoice_charges: [],
    invoice_time_entries: [],
    service_catalog: [],
    tax_rates: [],
  };

  const tables: Record<string, Array<Record<string, any>>> = {
    invoice_charges: existingInvoiceCharges.map((row) => ({ ...row })),
    invoice_time_entries: [],
    service_catalog: [],
    tax_rates: [],
  };

  const tx: any = (tableName: string) => {
    let filteredRows = tables[tableName] ?? [];

    const builder: any = {
      where(criteria: Record<string, any> | string, value?: unknown) {
        filteredRows = filteredRows.filter((row) => {
          if (typeof criteria === 'string') {
            return row[normalizeColumnName(criteria)] === value;
          }

          return Object.entries(criteria).every(
            ([key, expected]) => row[normalizeColumnName(key)] === expected,
          );
        });
        return builder;
      },
      select() {
        return builder;
      },
      orderByRaw() {
        return builder;
      },
      async first() {
        return filteredRows[0] ?? null;
      },
      async insert(payload: any) {
        inserts[tableName].push(payload);
        tables[tableName] ??= [];
        tables[tableName].push(payload);
        return [payload];
      },
    };

    return builder;
  };

  return { tx, inserts };
}

describe('manual invoice service-period policy', () => {
  it('returns NO_BILLING_EMAIL with the client name when no billing location email exists', async () => {
    const { tx } = createMockTx();

    await expect(validateClientBillingEmail(
      tx,
      'tenant-1',
      'client-1',
      'Omni Energy Partners',
    )).resolves.toMatchObject({
      valid: false,
      code: 'NO_BILLING_EMAIL',
      params: { clientName: 'Omni Energy Partners' },
    });
  });

  it('returns SERVICE_NOT_FOUND with the missing service identifier', async () => {
    const { tx } = createMockTx();

    await expect(persistManualInvoiceCharges(
      tx,
      'invoice-1',
      [{ service_id: 'service-404', description: 'Missing service', quantity: 1, rate: 2500 }] as any,
      { client_id: 'client-1', region_code: 'US-WA' },
      { user: { id: 'user-1' } } as any,
      'tenant-1',
    )).rejects.toMatchObject({
      code: 'SERVICE_NOT_FOUND',
      params: { serviceId: 'service-404' },
    });
  });

  it('returns INVALID_QUANTITY before persisting a non-positive line', async () => {
    const { tx, inserts } = createMockTx();

    await expect(persistManualInvoiceCharges(
      tx,
      'invoice-1',
      [{ description: 'Invalid quantity', quantity: 0, rate: 2500 }] as any,
      { client_id: 'client-1', region_code: 'US-WA' },
      { user: { id: 'user-1' } } as any,
      'tenant-1',
    )).rejects.toMatchObject({ code: 'INVALID_QUANTITY' });
    expect(inserts.invoice_charges).toHaveLength(0);
  });

  it('returns DISCOUNT_TARGET_NOT_FOUND with the missing service identifier', async () => {
    const { tx } = createMockTx();

    await expect(persistManualInvoiceCharges(
      tx,
      'invoice-1',
      [{
        description: 'Orphan discount',
        quantity: 1,
        rate: 100,
        is_discount: true,
        applies_to_service_id: 'service-404',
      }] as any,
      { client_id: 'client-1', region_code: 'US-WA' },
      { user: { id: 'user-1' } } as any,
      'tenant-1',
    )).rejects.toMatchObject({
      code: 'DISCOUNT_TARGET_NOT_FOUND',
      params: { serviceId: 'service-404' },
    });
  });

  it('manual invoice charges do not create time-entry source links', async () => {
    const { tx, inserts } = createMockTx();

    await persistManualInvoiceCharges(
      tx,
      'invoice-1',
      [
        {
          description: 'Manual adjustment',
          quantity: 1,
          rate: 2500,
          is_discount: false,
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

    expect(inserts.invoice_charges).toHaveLength(1);
    expect(inserts.invoice_time_entries).toHaveLength(0);
  });

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
