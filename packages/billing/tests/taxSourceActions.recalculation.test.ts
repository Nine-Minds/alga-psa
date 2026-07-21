import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  tenant: '10000000-0000-4000-8000-000000000001',
  invoice: {} as Record<string, any>,
  charges: [] as Array<Record<string, any>>,
  insertedTransactions: [] as Array<Record<string, any>>,
  recalculationCalls: 0,
  clientDetailCalls: 0,
}));

vi.mock('@alga-psa/auth', () => ({
  withAuth: (action: (...args: any[]) => unknown) => (...args: any[]) => (
    action({ user_id: 'user-1' }, { tenant: state.tenant }, ...args)
  ),
}));

vi.mock('@alga-psa/auth/rbac', () => ({
  hasPermission: vi.fn(async () => true),
}));

vi.mock('@alga-psa/db', () => {
  const makeQuery = (table: string) => {
    const query: Record<string, any> = {};
    for (const method of ['where', 'select', 'forUpdate', 'orderBy']) {
      query[method] = vi.fn(() => query);
    }
    query.first = vi.fn(async () => {
      if (table === 'invoices') return { ...state.invoice };
      if (table === 'transactions') return { balance_after: 5_000 };
      return undefined;
    });
    query.update = vi.fn(async (updates: Record<string, any>) => {
      if (table === 'invoices') Object.assign(state.invoice, updates);
      if (table === 'invoice_charges') {
        state.charges.forEach((charge) => Object.assign(charge, updates));
      }
      return 1;
    });
    query.insert = vi.fn(async (row: Record<string, any>) => {
      if (table === 'transactions') state.insertedTransactions.push(row);
      return [row];
    });
    query.then = (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => (
      Promise.resolve(table === 'invoice_charges' ? state.charges.map((charge) => ({ ...charge })) : [])
        .then(resolve, reject)
    );
    return query;
  };

  const trx = Object.assign(vi.fn(), {
    fn: { now: vi.fn(() => '2026-07-15T12:00:00.000Z') },
  });
  return {
    createTenantKnex: vi.fn(async () => ({ knex: trx, tenant: state.tenant })),
    tenantDb: vi.fn(() => ({ table: vi.fn(makeQuery) })),
    withTransaction: vi.fn(async (_knex: unknown, callback: (transaction: unknown) => unknown) => callback(trx)),
  };
});

vi.mock('../src/services/invoiceService', () => ({
  getClientDetails: vi.fn(async () => {
    state.clientDetailCalls += 1;
    return { client_id: 'client-1', is_tax_exempt: false };
  }),
  calculateAndDistributeTax: vi.fn(async () => {
    state.recalculationCalls += 1;
    state.charges.forEach((charge) => {
      charge.tax_amount = 100;
    });
  }),
}));

vi.mock('../src/services/taxService', () => ({
  TaxService: class TaxService {},
}));

import { updateInvoiceTaxSource } from '../src/actions/taxSourceActions';

describe('updateInvoiceTaxSource tax and ledger recalculation', () => {
  beforeEach(() => {
    state.invoice = {
      invoice_id: 'invoice-1',
      status: 'draft',
      tax_source: 'external',
      client_id: 'client-1',
      invoice_number: 'INV-100',
      subtotal: 1_000,
      tax: 0,
      total_amount: 1_000,
    };
    state.charges = [{
      net_amount: 1_000,
      tax_amount: 0,
      external_tax_amount: 75,
      external_tax_code: 'EXT',
      external_tax_rate: 7.5,
    }];
    state.insertedTransactions = [];
    state.recalculationCalls = 0;
    state.clientDetailCalls = 0;
    vi.clearAllMocks();
  });

  it('recalculates charge tax, invoice totals, external fields, and the client-balance delta', async () => {
    await expect(updateInvoiceTaxSource('invoice-1', 'internal')).resolves.toEqual({ success: true });

    expect(state.recalculationCalls).toBe(1);
    expect(state.clientDetailCalls).toBe(1);
    expect(state.charges[0]).toMatchObject({
      tax_amount: 100,
      external_tax_amount: null,
      external_tax_code: null,
      external_tax_rate: null,
    });
    expect(state.invoice).toMatchObject({
      tax_source: 'internal',
      subtotal: 1_000,
      tax: 100,
      total_amount: 1_100,
    });
    expect(state.insertedTransactions).toEqual([
      expect.objectContaining({
        invoice_id: 'invoice-1',
        client_id: 'client-1',
        amount: 100,
        type: 'invoice_adjustment',
        balance_after: 5_100,
      }),
    ]);
  });

  it('does not recalculate or add a ledger row when the source is unchanged', async () => {
    state.invoice.tax_source = 'internal';

    await expect(updateInvoiceTaxSource('invoice-1', 'internal')).resolves.toEqual({ success: true });
    expect(state.recalculationCalls).toBe(0);
    expect(state.insertedTransactions).toEqual([]);
  });
});
