import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  invoice: { invoice_id: 'inv-1', client_id: 'client-1', status: 'sent', total_amount: 1200, credit_applied: 0, currency_code: 'USD' },
  existing: { payment_id: 'pay-existing' }, inserts: 0, transactions: 0,
}));

vi.mock('@alga-psa/db', () => ({
  tenantDb: (_knex: unknown, _tenant: string) => ({
    table: (name: string) => {
      let aggregate = false;
      const builder: any = {
        where: () => builder, select: () => builder, forUpdate: () => builder, orderBy: () => builder,
        first: async () => name === 'invoices' ? state.invoice : name === 'invoice_payments' ? (aggregate ? { total: 1200 } : state.existing) : { total: 0 },
        sum: () => { aggregate = true; return builder; },
        insert: () => { state.inserts += 1; return builder; },
      };
      return builder;
    },
  }),
}));
vi.mock('../src/services/accountingSync/syncProducers', () => ({ enqueueExternalPaymentPush: vi.fn() }));
vi.mock('../src/services/accountingSync/invoiceTerminalStatusHandlers', () => ({ notifyInvoiceTerminalStatus: vi.fn() }));
vi.mock('../src/services/prepaidReplenishmentSettlement', () => ({ settlePrepaidReplenishmentInvoice: vi.fn() }));

import { recordExternalPayment } from '../src/services/accountingSync/recordExternalPayment';

describe('recordExternalPayment de-duplication', () => {
  beforeEach(() => { state.inserts = 0; state.transactions = 0; });

  it('returns the existing payment while holding the invoice lock and does not insert again', async () => {
    const trx: any = {};
    const knex: any = { transaction: async (fn: (trx: any) => Promise<unknown>) => { state.transactions += 1; return fn(trx); } };
    const result = await recordExternalPayment(knex, 'tenant-1', {
      invoiceId: 'inv-1', amount: 1200, provider: 'stripe', referenceNumber: 'pi-1', currency: 'USD',
    });

    expect(result).toMatchObject({ success: true, paymentRecorded: false, paymentId: 'pay-existing', alreadyRecorded: true });
    expect(state.transactions).toBe(1);
    expect(state.inserts).toBe(0);
  });
});
