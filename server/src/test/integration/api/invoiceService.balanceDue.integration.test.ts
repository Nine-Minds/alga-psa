import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { v4 as uuidv4 } from 'uuid';

import { InvoiceService } from '../../../lib/api/services/InvoiceService';
import { computeBalanceDue } from '../../../../../packages/billing/src/lib/balanceDue';
import { TestContext } from '../../../../test-utils/testContext';

const helpers = TestContext.createHelpers();

describe('InvoiceService balance_due nets payments (list + detail)', () => {
  const HOOK_TIMEOUT = 240_000;
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await helpers.beforeAll({
      cleanupTables: ['invoice_payments', 'invoices'],
    });
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    await helpers.afterAll();
  }, HOOK_TIMEOUT);

  beforeEach(async () => {
    ctx = await helpers.beforeEach();
    await ctx.db('invoice_payments').where({ tenant: ctx.tenantId }).del();
    await ctx.db('invoices').where({ tenant: ctx.tenantId }).del();
  }, HOOK_TIMEOUT);

  afterEach(async () => {
    vi.restoreAllMocks();
    await helpers.afterEach();
  }, HOOK_TIMEOUT);

  async function seedInvoice(total: number, credit: number, payments: number[]): Promise<string> {
    const invoiceId = uuidv4();
    await ctx.db('invoices').insert({
      invoice_id: invoiceId,
      tenant: ctx.tenantId,
      client_id: ctx.clientId,
      invoice_number: `INV-BAL-${invoiceId.slice(0, 8)}`,
      invoice_date: '2026-01-15',
      due_date: '2026-02-15',
      subtotal: total,
      tax: 0,
      total_amount: total,
      credit_applied: credit,
      status: 'sent',
      currency_code: 'USD',
      is_manual: false,
    });
    for (const amount of payments) {
      await ctx.db('invoice_payments').insert({
        payment_id: uuidv4(),
        tenant: ctx.tenantId,
        invoice_id: invoiceId,
        amount,
        payment_method: 'stripe',
        status: amount < 0 ? 'reversed' : 'completed',
      });
    }
    return invoiceId;
  }

  function makeService() {
    const service = new InvoiceService();
    vi.spyOn(service as any, 'validatePermissions').mockResolvedValue(undefined);
    vi.spyOn(service as any, 'getKnex').mockResolvedValue({ knex: ctx.db });
    return service;
  }

  const context = () => ({ tenant: ctx.tenantId, userId: ctx.userId }) as any;

  const cases = [
    { name: 'partial payment', total: 100000, credit: 0, payments: [1000] },
    { name: 'full payment', total: 100000, credit: 0, payments: [100000] },
    { name: 'multiple payments', total: 100000, credit: 0, payments: [25000, 25000] },
    { name: 'credit plus payment', total: 100000, credit: 20000, payments: [30000] },
    { name: 'payment then reversal (negative row)', total: 100000, credit: 0, payments: [100000, -100000] },
    { name: 'no payments (regression guard)', total: 100000, credit: 0, payments: [] as number[] },
    { name: 'no payments with credit (regression guard)', total: 100000, credit: 15000, payments: [] as number[] },
  ];

  it.each(cases)('$name: list and detail balance_due equal computeBalanceDue', async ({ total, credit, payments }) => {
    const invoiceId = await seedInvoice(total, credit, payments);
    const expected = computeBalanceDue({
      totalAmount: total,
      creditApplied: credit,
      totalPaid: payments.reduce((a, b) => a + b, 0),
    });
    const service = makeService();

    const detail = await service.getById(invoiceId, context(), { include_items: false });
    expect(Number((detail as any).balance_due)).toBe(expected);

    const list = await service.list({ page: 1, limit: 50 } as any, context(), {} as any);
    const row = list.data.find((invoice: any) => invoice.invoice_id === invoiceId);
    expect(Number((row as any).balance_due)).toBe(expected);
  }, HOOK_TIMEOUT);

  it('does not duplicate invoice rows when several payments exist', async () => {
    const invoiceId = await seedInvoice(100000, 0, [10000, 20000, 30000]);
    const service = makeService();

    const list = await service.list({ page: 1, limit: 50 } as any, context(), {} as any);

    expect(list.data.filter((invoice: any) => invoice.invoice_id === invoiceId)).toHaveLength(1);
    expect(list.total).toBe(1);
  }, HOOK_TIMEOUT);
});
