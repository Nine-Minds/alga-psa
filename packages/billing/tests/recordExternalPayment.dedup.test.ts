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
        insert: () => { if (name === 'invoice_payments') state.inserts += 1; return builder; },
        returning: async () => [{ payment_id: 'pay-new' }],
        update: async () => 1,
      };
      return builder;
    },
  }),
}));
const publishWorkflowEvent = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock('@alga-psa/event-bus/publishers', () => ({ publishWorkflowEvent }));
vi.mock('@alga-psa/core/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock('../src/services/accountingSync/syncProducers', () => ({ enqueueExternalPaymentPush: vi.fn() }));
vi.mock('../src/services/accountingSync/invoiceTerminalStatusHandlers', () => ({ notifyInvoiceTerminalStatus: vi.fn() }));
vi.mock('../src/services/prepaidReplenishmentSettlement', () => ({ settlePrepaidReplenishmentInvoice: vi.fn() }));

import { recordExternalPayment } from '../src/services/accountingSync/recordExternalPayment';

describe('recordExternalPayment de-duplication', () => {
  beforeEach(() => { state.inserts = 0; state.transactions = 0; publishWorkflowEvent.mockClear(); });

  it('returns the existing payment while holding the invoice lock and does not insert again', async () => {
    const trx: any = {};
    const knex: any = { transaction: async (fn: (trx: any) => Promise<unknown>) => { state.transactions += 1; return fn(trx); } };
    const result = await recordExternalPayment(knex, 'tenant-1', {
      invoiceId: 'inv-1', amount: 1200, provider: 'stripe', referenceNumber: 'pi-1', currency: 'USD', dedupeByReference: true,
    });

    expect(result).toMatchObject({ success: true, paymentRecorded: false, paymentId: 'pay-existing', alreadyRecorded: true });
    expect(state.transactions).toBe(1);
    expect(state.inserts).toBe(0);
  });

  it('inserts a new payment for a repeated reference when the caller does not opt into de-duplication', async () => {
    // Accounting-sync appliers re-apply a replaced credit-note allocation under the
    // reversed allocation's reference; their sync ledger, not the reference, is the identity.
    const knex: any = { transaction: async (fn: (trx: any) => Promise<unknown>) => fn({ fn: { now: () => 'now' } }) };
    const result = await recordExternalPayment(knex, 'tenant-1', {
      invoiceId: 'inv-1', amount: 1200, provider: 'xero', referenceNumber: 'CN-1', currency: 'USD',
    });

    expect(result).toMatchObject({ success: true, paymentRecorded: true, paymentId: 'pay-new' });
    expect(result.alreadyRecorded).toBeUndefined();
    expect(state.inserts).toBe(1);
  });

  it('does not publish PAYMENT_RECORDED for a dedupe hit / alreadyRecorded', async () => {
    const knex: any = { transaction: async (fn: (trx: any) => Promise<unknown>) => fn({}) };
    await recordExternalPayment(knex, 'tenant-1', {
      invoiceId: 'inv-1', amount: 1200, provider: 'stripe', referenceNumber: 'pi-1', currency: 'USD',
      dedupeByReference: true, source: 'online_payment',
    });
    expect(publishWorkflowEvent).not.toHaveBeenCalled();
  });

  it('publishes PAYMENT_RECORDED once, after commit, with explicit provenance on a real insert', async () => {
    const order: string[] = [];
    const knex: any = {
      transaction: async (fn: (trx: any) => Promise<unknown>) => {
        const r = await fn({ fn: { now: () => 'now' } });
        order.push('commit');
        return r;
      },
    };
    publishWorkflowEvent.mockImplementationOnce(async () => { order.push('publish'); });
    await recordExternalPayment(knex, 'tenant-1', {
      invoiceId: 'inv-1', amount: 1200, provider: 'stripe', referenceNumber: 'pi-2', currency: 'USD',
      source: 'online_payment', gatewayTransactionId: 'pi-2',
    });
    expect(order).toEqual(['commit', 'publish']);
    expect(publishWorkflowEvent).toHaveBeenCalledTimes(1);
    const call = publishWorkflowEvent.mock.calls[0][0] as any;
    expect(call).toMatchObject({
      eventType: 'PAYMENT_RECORDED',
      idempotencyKey: 'payment_recorded:pay-new',
      ctx: { tenantId: 'tenant-1' },
      payload: { paymentId: 'pay-new', clientId: 'client-1', amount: '1200', currency: 'USD', method: 'stripe', source: 'online_payment' },
    });
  });

  it('omits provenance when the caller supplies none (consumers default-deny)', async () => {
    const knex: any = { transaction: async (fn: (trx: any) => Promise<unknown>) => fn({ fn: { now: () => 'now' } }) };
    await recordExternalPayment(knex, 'tenant-1', {
      invoiceId: 'inv-1', amount: 1200, provider: 'xero', referenceNumber: 'CN-2', currency: 'USD',
    });
    expect((publishWorkflowEvent.mock.calls[0][0] as any).payload.source).toBeUndefined();
  });

  it('does not publish when running inside a caller-owned transaction (accounting-sync applier)', async () => {
    const knex: any = { isTransaction: true, transaction: async (fn: (trx: any) => Promise<unknown>) => fn({ fn: { now: () => 'now' } }) };
    const result = await recordExternalPayment(knex, 'tenant-1', {
      invoiceId: 'inv-1', amount: 1200, provider: 'quickbooks', referenceNumber: 'QB-1', currency: 'USD',
      source: 'accounting_sync',
    });
    expect(result.paymentRecorded).toBe(true);
    expect(publishWorkflowEvent).not.toHaveBeenCalled();
  });

  it('does not publish when the insert fails the transaction', async () => {
    const knex: any = { transaction: async () => { throw new Error('boom'); } };
    await expect(recordExternalPayment(knex, 'tenant-1', {
      invoiceId: 'inv-1', amount: 1200, provider: 'stripe', referenceNumber: 'pi-3', currency: 'USD', source: 'online_payment',
    })).rejects.toThrow('boom');
    expect(publishWorkflowEvent).not.toHaveBeenCalled();
  });
});
