import { describe, expect, it, vi } from 'vitest';

import { BillingEngine } from '../../../../../packages/billing/src/lib/billing/billingEngine';
import {
  calculateAndDistributeTax,
  reconcileInvoiceAdjustmentTransaction,
} from '../../../../../packages/billing/src/services/invoiceService';

vi.mock('../../../../../packages/billing/src/services/invoiceService', () => ({
  calculateAndDistributeTax: vi.fn(async () => undefined),
  reconcileInvoiceAdjustmentTransaction: vi.fn(async () => undefined),
  getClientDetails: vi.fn(),
}));

vi.mock('../../../../../packages/billing/src/services/taxService', () => ({
  TaxService: class TaxService {},
}));

function createBuilder(result: Record<string, unknown> | null) {
  const builder: any = {};
  builder.where = vi.fn(() => builder);
  builder.first = vi.fn(async () => result);
  builder.forUpdate = vi.fn(() => builder);
  builder.select = vi.fn(async () => [{ net_amount: 10000, tax_amount: 600 }]);
  builder.update = vi.fn(async () => 1);
  return builder;
}

describe('BillingEngine recalculation recurring detail preservation', () => {
  it('T206: recalculation leaves canonical recurring detail periods authoritative and only recomputes tax plus totals', async () => {
    const queriedTables: string[] = [];
    const trx = vi.fn((table: string) => {
      queriedTables.push(`trx:${table}`);

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
    const knex = vi.fn(() => { throw new Error('root connection should not be queried'); }) as any;
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
    expect(reconcileInvoiceAdjustmentTransaction).toHaveBeenCalledWith(
      trx,
      'tenant-1',
      expect.objectContaining({ invoice_id: 'invoice-1', client_id: 'client-1' }),
      10600,
    );
    expect(queriedTables).toEqual(['trx:invoices', 'trx:clients', 'trx:invoice_charges', 'trx:invoices']);
    expect(queriedTables).not.toContain('invoice_charge_details');
    expect(queriedTables).not.toContain('trx:invoice_charge_details');
  });

  it('joins an existing transaction instead of opening a nested transaction', async () => {
    const queriedTables: string[] = [];
    const trx = vi.fn((table: string) => {
      queriedTables.push(`trx:${table}`);
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

    const knex = vi.fn(() => {
      throw new Error('root connection should not be queried');
    }) as any;
    knex.transaction = vi.fn();

    const engine = new BillingEngine();
    (engine as any).tenant = 'tenant-1';
    (engine as any).knex = knex;
    (engine as any).initKnex = vi.fn(async () => undefined);

    await engine.recalculateInvoice('invoice-1', trx, 'tenant-1');

    expect(knex).not.toHaveBeenCalled();
    expect(knex.transaction).not.toHaveBeenCalled();
    expect((engine as any).initKnex).not.toHaveBeenCalled();
    expect(queriedTables).toEqual(['trx:invoices', 'trx:clients', 'trx:invoice_charges', 'trx:invoices']);
    expect(calculateAndDistributeTax).toHaveBeenLastCalledWith(
      trx,
      'invoice-1',
      expect.objectContaining({ client_id: 'client-1' }),
      expect.any(Object),
      'tenant-1',
    );
  });
});

// These fixtures characterize orchestration with no pending contract events.
// Database settlement and discount lifecycle are covered by the invoice integration suite.
vi.mock('@alga-psa/billing/lib/billing/reconcileContractChangeAdjustments', async importOriginal => ({
  ...(await importOriginal<typeof import('@alga-psa/billing/lib/billing/reconcileContractChangeAdjustments')>()),
  resolveContractChangeChargesForWindow: vi.fn(async () => []),
  releaseOrphanedContractAdjustments: vi.fn(async () => undefined),
  reconcileContractChangeAdjustmentsForInvoice: vi.fn(async () => ({ changed: false, settledInvoiceId: null, amountCents: 0 })),
}));
vi.mock('@alga-psa/billing/lib/billing/reconcileAutomaticInvoiceDiscounts', () => ({
  reconcileAutomaticInvoiceAdjustments: vi.fn(async () => 0),
}));
