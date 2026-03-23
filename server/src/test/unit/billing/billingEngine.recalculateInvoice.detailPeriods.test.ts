import { describe, expect, it, vi } from 'vitest';

import { BillingEngine } from '../../../../../packages/billing/src/lib/billing/billingEngine';
import {
  calculateAndDistributeTax,
  updateInvoiceTotalsAndRecordTransaction,
} from '../../../../../packages/billing/src/services/invoiceService';

vi.mock('../../../../../packages/billing/src/services/invoiceService', () => ({
  calculateAndDistributeTax: vi.fn(async () => undefined),
  updateInvoiceTotalsAndRecordTransaction: vi.fn(async () => undefined),
  getClientDetails: vi.fn(),
}));

vi.mock('../../../../../packages/billing/src/services/taxService', () => ({
  TaxService: class TaxService {},
}));

function createBuilder(result: Record<string, unknown> | null) {
  const builder: any = {};
  builder.where = vi.fn(() => builder);
  builder.first = vi.fn(async () => result);
  return builder;
}

describe('BillingEngine recalculation recurring detail preservation', () => {
  it('T206: recalculation leaves canonical recurring detail periods authoritative and only recomputes tax plus totals', async () => {
    const queriedTables: string[] = [];
    const trx = vi.fn((table: string) => {
      queriedTables.push(`trx:${table}`);
      return createBuilder(null);
    }) as any;

    const knex = vi.fn((table: string) => {
      queriedTables.push(table);
      if (table === 'invoices') {
        return createBuilder({
          invoice_id: 'invoice-1',
          client_id: 'client-1',
          invoice_number: 'INV-1001',
          tenant: 'tenant-1',
        });
      }

      if (table === 'clients') {
        return createBuilder({
          client_id: 'client-1',
          client_name: 'Acme Co',
          is_tax_exempt: false,
        });
      }

      return createBuilder(null);
    }) as any;
    knex.transaction = vi.fn(async (callback: any) => callback(trx));

    const engine = new BillingEngine();
    (engine as any).tenant = 'tenant-1';
    (engine as any).knex = knex;
    (engine as any).initKnex = vi.fn(async () => undefined);

    await engine.recalculateInvoice('invoice-1');

    expect(calculateAndDistributeTax).toHaveBeenCalledWith(
      trx,
      'invoice-1',
      expect.objectContaining({ client_id: 'client-1' }),
      expect.any(Object),
      'tenant-1'
    );
    expect(updateInvoiceTotalsAndRecordTransaction).toHaveBeenCalledWith(
      trx,
      'invoice-1',
      expect.objectContaining({ client_id: 'client-1' }),
      'tenant-1',
      'INV-1001',
      undefined,
      expect.objectContaining({
        transactionType: 'invoice_adjustment',
      })
    );
    expect(queriedTables).toEqual(['invoices', 'clients']);
    expect(queriedTables).not.toContain('invoice_charge_details');
    expect(queriedTables).not.toContain('trx:invoice_charge_details');
  });
});
