import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { TestContext } from '../../../../test-utils/testContext';
import { ensureDefaultBillingSettings } from '../../../../test-utils/billingTestHelpers';

vi.mock('../../../lib/eventBus/publishers', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    publishEvent: vi.fn().mockResolvedValue(undefined),
    publishWorkflowEvent: vi.fn().mockResolvedValue(undefined),
  };
});
vi.mock('@alga-psa/auth', async () => {
  const { createAuthModuleMock } = await import('../../../../test-utils/authModuleMock');
  return createAuthModuleMock();
});
vi.mock('@alga-psa/auth/rbac', () => ({
  hasPermission: vi.fn(() => Promise.resolve(true)),
}));

import { setupCommonMocks } from '../../../../test-utils/testMocks';
import { InvoiceService } from '@/lib/api/services/InvoiceService';
import { handleApiError } from '@/lib/api/middleware/apiMiddleware';

process.env.DB_PORT = process.env.DB_PORT === '6432' ? '5432' : process.env.DB_PORT;
process.env.DB_HOST = process.env.DB_HOST === 'pgbouncer' ? 'localhost' : process.env.DB_HOST;

const {
  beforeAll: setupContext,
  beforeEach: resetContext,
  afterEach: rollbackContext,
  afterAll: cleanupContext,
} = TestContext.createHelpers();

describe('POST /api/v1/invoices (InvoiceService.create) is draft-only', () => {
  let context: TestContext;

  beforeAll(async () => {
    context = await setupContext({ runSeeds: false });
  }, 120000);

  beforeEach(async () => {
    context = await resetContext();
    setupCommonMocks({ tenantId: context.tenantId, userId: context.userId, permissionCheck: () => true });
    await ensureDefaultBillingSettings(context);
  }, 30000);

  afterEach(async () => {
    await rollbackContext();
  }, 30000);

  afterAll(async () => {
    await cleanupContext();
  }, 120000);

  function serviceUnderTest() {
    const service = new InvoiceService();
    vi.spyOn(service as any, 'getKnex').mockResolvedValue({ knex: context.db, tenant: context.tenantId });
    vi.spyOn(service as any, 'validatePermissions').mockResolvedValue(undefined);
    return service;
  }
  const ctx = () => ({ tenant: context.tenantId, userId: context.userId } as any);
  const base = () => ({ client_id: context.clientId, invoice_date: '2026-03-01', due_date: '2026-03-31' });
  const invoiceCount = async () =>
    Number((await context.db('invoices').where({ tenant: context.tenantId }).count('* as n').first())?.n ?? 0);
  const headerOf = (invoiceId: string) =>
    context.db('invoices').where({ tenant: context.tenantId, invoice_id: invoiceId }).first();

  let baselineCount = 0;
  beforeEach(async () => {
    baselineCount = await invoiceCount();
  });

  it("a 'sent' status is a 400 at the API boundary and creates nothing", async () => {
    const error = await serviceUnderTest()
      .create({ ...base(), status: 'sent', subtotal: 0, tax: 0, total_amount: 0 } as any, ctx())
      .then(() => null, (e) => e);
    expect(error).toMatchObject({ statusCode: 400, message: expect.stringContaining('status') });
    expect(handleApiError(error).status).toBe(400);
    expect(await invoiceCount()).toBe(baselineCount);
  });

  it('a non-zero credit_applied is a 400 and creates nothing', async () => {
    const error = await serviceUnderTest()
      .create({ ...base(), credit_applied: 25 } as any, ctx())
      .then(() => null, (e) => e);
    expect(error).toMatchObject({ statusCode: 400, message: expect.stringContaining('credit_applied') });
    expect(await invoiceCount()).toBe(baselineCount);
  });

  it('header totals come from the charges, not the posted values', async () => {
    const created = await serviceUnderTest().create(
      {
        ...base(),
        status: 'draft',
        credit_applied: 0,
        subtotal: 999999,
        tax: 123456,
        total_amount: 1,
        items: [
          { description: 'A', quantity: 1, unit_price: 1000 },
          { description: 'B', quantity: 2, unit_price: 500 },
        ],
      } as any,
      ctx(),
    );
    const header = await headerOf((created as any).invoice_id);
    const charges = await context.db('invoice_charges')
      .where({ tenant: context.tenantId, invoice_id: header.invoice_id });
    const net = charges.reduce((s: number, c: any) => s + Number(c.net_amount), 0);
    const tax = charges.reduce((s: number, c: any) => s + Number(c.tax_amount), 0);

    expect(header.status).toBe('draft');
    expect(Number(header.credit_applied)).toBe(0);
    expect(net).toBe(2000);
    expect(Number(header.subtotal)).toBe(2000);
    expect(Number(header.tax)).toBe(Math.round(tax));
    expect(Number(header.total_amount)).toBe(Math.round(net + tax));
  });

  it('an invoice without items has zero totals whatever the body says', async () => {
    const created = await serviceUnderTest().create(
      { ...base(), subtotal: 500, tax: 50, total_amount: 550 } as any,
      ctx(),
    );
    const header = await headerOf((created as any).invoice_id);
    expect([Number(header.subtotal), Number(header.tax), Number(header.total_amount)]).toEqual([0, 0, 0]);
  });

  it('the duplicate endpoint payload (status draft, credit 0) still creates a draft', async () => {
    // Mirrors ApiInvoiceController duplicate: echoes the original's totals and sends draft / credit 0.
    const created = await serviceUnderTest().create(
      {
        ...base(),
        subtotal: 2000,
        tax: 0,
        total_amount: 2000,
        status: 'draft' as const,
        credit_applied: 0,
        is_manual: true,
        is_prepayment: false,
        items: [{ description: 'A', quantity: 1, unit_price: 2000 }],
      } as any,
      ctx(),
    );
    const header = await headerOf((created as any).invoice_id);
    expect(header.status).toBe('draft');
    // Total is the engine derivation (net + tax of the persisted charges), not the echoed 2000.
    const charges = await context.db('invoice_charges')
      .where({ tenant: context.tenantId, invoice_id: header.invoice_id });
    const derived = charges.reduce((s: number, c: any) => s + Number(c.net_amount) + Number(c.tax_amount), 0);
    expect(Number(header.total_amount)).toBe(Math.round(derived));
  });
});
