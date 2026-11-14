import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
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
vi.mock('@/lib/auth/rbac', () => ({
  hasPermission: vi.fn(() => Promise.resolve(true)),
}));

import { v4 as uuidv4 } from 'uuid';
import { setupCommonMocks } from '../../../../test-utils/testMocks';
import { ApiInvoiceController } from '@/lib/api/controllers/ApiInvoiceController';
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
    return service;
  }

  class TestInvoiceController extends ApiInvoiceController {
    protected async authenticate(req: NextRequest) {
      return Object.assign(req, { context: ctx() }) as any;
    }

    protected async checkPermission(_req: any, action: string) {
      expect(['create', 'update']).toContain(action);
    }

    protected runWithApiKeyContext<T>(_req: any, callback: () => Promise<T>): Promise<T> {
      return callback();
    }
  }

  function controllerUnderTest() {
    const controller = new TestInvoiceController();
    // Keep the controller's real schema and InvoiceService.create, but direct
    // the service to this integration test's transaction-scoped database.
    vi.spyOn((controller as any).invoiceService, 'getKnex')
      .mockResolvedValue({ knex: context.db, tenant: context.tenantId });
    return controller;
  }

  function postInvoice(body: Record<string, unknown>) {
    const controller = controllerUnderTest();
    const request = new NextRequest('http://localhost/api/v1/invoices', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    return controller.create()(request);
  }

  function putInvoice(invoiceId: string, body: Record<string, unknown>) {
    const controller = controllerUnderTest();
    const request = new NextRequest(`http://localhost/api/v1/invoices/${invoiceId}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    (request as any).params = Promise.resolve({ id: invoiceId });
    return controller.update()(request);
  }

  function duplicateInvoice(invoiceId: string) {
    const controller = controllerUnderTest();
    const request = new NextRequest(`http://localhost/api/v1/invoices/${invoiceId}/duplicate`, {
      method: 'POST',
    });
    (request as any).params = Promise.resolve({ id: invoiceId });
    return controller.duplicate()(request);
  }

  const ctx = () => ({
    tenant: context.tenantId,
    userId: context.userId,
    user: { user_id: context.userId, user_type: 'internal' },
  } as any);
  const base = () => ({ client_id: context.clientId, invoice_date: '2026-03-01', due_date: '2026-03-31' });
  const invoiceCount = async () =>
    Number((await context.db('invoices').where({ tenant: context.tenantId }).count('* as n').first())?.n ?? 0);
  const chargeCount = async () =>
    Number((await context.db('invoice_charges').where({ tenant: context.tenantId }).count('* as n').first())?.n ?? 0);
  const headerOf = (invoiceId: string) =>
    context.db('invoices').where({ tenant: context.tenantId, invoice_id: invoiceId }).first();

  let baselineCount = 0;
  let baselineChargeCount = 0;
  beforeEach(async () => {
    baselineCount = await invoiceCount();
    baselineChargeCount = await chargeCount();
  });

  it("a 'sent' status is a 400 at the API boundary and creates nothing", async () => {
    const error = await serviceUnderTest()
      .create({ ...base(), status: 'sent', subtotal: 0, tax: 0, total_amount: 0 } as any, ctx())
      .then(() => null, (e) => e);
    expect(error).toMatchObject({ statusCode: 400, message: expect.stringContaining('status') });
    expect(handleApiError(error).status).toBe(400);
    expect(await invoiceCount()).toBe(baselineCount);
  });

  it('POST rejects a non-draft status through the controller without writing an invoice', async () => {
    const response = await postInvoice({
      ...base(), status: 'sent',
    });

    expect(response.status).toBe(400);
    expect(JSON.stringify(await response.json())).toContain('status');
    expect(await invoiceCount()).toBe(baselineCount);
  });

  it('POST rejects non-zero credit through the controller without writing an invoice', async () => {
    const response = await postInvoice({ ...base(), credit_applied: 25 });

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { message: expect.stringContaining('credit_applied') } });
    expect(await invoiceCount()).toBe(baselineCount);
  });

  it.each(['subtotal', 'tax', 'total_amount'])('POST rejects supplied %s, even when zero, before any write', async (field) => {
    const response = await postInvoice({ ...base(), [field]: 0 });
    expect(response.status).toBe(400);
    expect(JSON.stringify(await response.json())).toContain(field);
    expect(await invoiceCount()).toBe(baselineCount);
    expect(await chargeCount()).toBe(baselineChargeCount);
  });

  it('POST retains the tax_source rejection and names its owning command', async () => {
    const response = await postInvoice({ ...base(), tax_source: 'external' });
    expect(response.status).toBe(400);
    expect(await response.text()).toContain('changeInvoiceTaxSource');
    expect(await invoiceCount()).toBe(baselineCount);
    expect(await chargeCount()).toBe(baselineChargeCount);
  });

  it.each(['subtotal', 'tax', 'total_amount'])('service rejects supplied %s, even when zero, before any write', async (field) => {
    const error = await serviceUnderTest()
      .create({ ...base(), [field]: 0 } as any, ctx())
      .then(() => null, (e) => e);
    expect(error).toMatchObject({ statusCode: 400, message: expect.stringContaining(field) });
    expect(await invoiceCount()).toBe(baselineCount);
    expect(await chargeCount()).toBe(baselineChargeCount);
  });

  it('POST creates an authorized draft through the controller, schema, and service', async () => {
    const response = await postInvoice({
      ...base(),
      status: 'draft',
      credit_applied: 0,
      items: [{ description: 'HTTP work', quantity: 2, unit_price: 750, rate: 750, tax_amount: 0 }],
    });

    expect(response.status).toBe(201);
    const { data } = await response.json();
    const header = await headerOf(data.invoice_id);
    const charges = await context.db('invoice_charges')
      .where({ tenant: context.tenantId, invoice_id: data.invoice_id });
    const net = charges.reduce((sum: number, charge: any) => sum + Number(charge.net_amount), 0);
    const tax = charges.reduce((sum: number, charge: any) => sum + Number(charge.tax_amount), 0);

    expect(header.status).toBe('draft');
    expect(Number(header.credit_applied)).toBe(0);
    expect(Number(header.subtotal)).toBe(net);
    expect(Number(header.tax)).toBe(Math.round(tax));
    expect(Number(header.total_amount)).toBe(Math.round(net + tax));
  });

  it('POST duplicate endpoint creates a new draft with zero credit and charge-derived totals', async () => {
    const created = await serviceUnderTest().create({
      ...base(), items: [{ description: 'Duplicate source', quantity: 1, unit_price: 2300 }],
    } as any, ctx());

    const response = await duplicateInvoice((created as any).invoice_id);

    expect(response.status).toBe(201);
    const { data } = await response.json();
    const header = await headerOf(data.invoice_id);
    const charges = await context.db('invoice_charges')
      .where({ tenant: context.tenantId, invoice_id: data.invoice_id });
    const derived = charges.reduce((sum: number, charge: any) =>
      sum + Number(charge.net_amount) + Number(charge.tax_amount), 0);

    expect(header.invoice_id).not.toBe((created as any).invoice_id);
    expect(header.status).toBe('draft');
    expect(header.is_manual).toBe(true);
    expect(Number(header.credit_applied)).toBe(0);
    expect(charges.length).toBeGreaterThan(0);
    expect(Number(header.total_amount)).toBe(Math.round(derived));
  });

  it('a non-zero credit_applied is a 400 and creates nothing', async () => {
    const error = await serviceUnderTest()
      .create({ ...base(), credit_applied: 25 } as any, ctx())
      .then(() => null, (e) => e);
    expect(error).toMatchObject({ statusCode: 400, message: expect.stringContaining('credit_applied') });
    expect(await invoiceCount()).toBe(baselineCount);
  });

  it('header totals come from the charges', async () => {
    const created = await serviceUnderTest().create(
      {
        ...base(),
        status: 'draft',
        credit_applied: 0,
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

  it('an invoice without items has zero totals', async () => {
    const created = await serviceUnderTest().create(
      { ...base() } as any,
      ctx(),
    );
    const header = await headerOf((created as any).invoice_id);
    expect([Number(header.subtotal), Number(header.tax), Number(header.total_amount)]).toEqual([0, 0, 0]);
  });

  it.each([
    ['empty item', {}],
    ['item without monetary inputs', { description: 'missing monetary inputs' }],
  ])('rejects an %s replacement without deleting existing charges', async (_label, item) => {
    const created = await serviceUnderTest().create({
      ...base(), items: [{ description: 'existing charge', quantity: 1, unit_price: 1200 }],
    } as any, ctx());
    const before = await context.db('invoice_charges')
      .where({ tenant: context.tenantId, invoice_id: (created as any).invoice_id })
      .select('item_id', 'description', 'unit_price', 'quantity');

    const response = await putInvoice((created as any).invoice_id, { items: [item] });

    expect(response.status).toBe(400);
    expect(JSON.stringify(await response.json())).toContain('items');
    const after = await context.db('invoice_charges')
      .where({ tenant: context.tenantId, invoice_id: (created as any).invoice_id })
      .select('item_id', 'description', 'unit_price', 'quantity');
    expect(after).toEqual(before);
  });

  it('accepts a complete replacement item and persists it', async () => {
    const created = await serviceUnderTest().create({
      ...base(), items: [{ description: 'original charge', quantity: 1, unit_price: 1200 }],
    } as any, ctx());

    const response = await putInvoice((created as any).invoice_id, {
      items: [{ description: 'replacement charge', quantity: 3, unit_price: 400, rate: 400, tax_amount: 0 }],
    });

    expect(response.status).toBe(200);
    const charges = await context.db('invoice_charges')
      .where({ tenant: context.tenantId, invoice_id: (created as any).invoice_id });
    expect(charges).toHaveLength(1);
    expect(charges[0].description).toBe('replacement charge');
    expect(Number(charges[0].quantity)).toBe(3);
    expect(Number(charges[0].unit_price)).toBe(400);
  });

  it.each([['is_manual'], ['is_prepayment']])('%s = true in the create body is a 400 and creates nothing', async (field) => {
    const error = await serviceUnderTest()
      .create({ ...base(), [field]: true } as any, ctx())
      .then(() => null, (e) => e);
    expect(error).toMatchObject({ statusCode: 400, message: expect.stringContaining(field) });
    expect(handleApiError(error).status).toBe(400);
    expect(await invoiceCount()).toBe(baselineCount);
  });

  it('create persists is_manual / is_prepayment at their defaults', async () => {
    const created = await serviceUnderTest().create(
      { ...base(), is_manual: false, is_prepayment: false } as any,
      ctx(),
    );
    const header = await headerOf((created as any).invoice_id);
    expect([header.is_manual, header.is_prepayment]).toEqual([false, false]);
  });

  it('duplicate() sets is_manual server-side on a new draft with engine-derived totals', async () => {
    const service = serviceUnderTest();
    const original = await service.create(
      { ...base(), items: [{ description: 'A', quantity: 1, unit_price: 2000 }] } as any,
      ctx(),
    );
    const duplicated = await service.duplicate((original as any).invoice_id, ctx());
    const header = await headerOf((duplicated as any).invoice_id);
    expect(header.invoice_id).not.toBe((original as any).invoice_id);
    expect(header.status).toBe('draft');
    expect(header.is_manual).toBe(true);
    expect(header.is_prepayment).toBe(false);
    const charges = await context.db('invoice_charges')
      .where({ tenant: context.tenantId, invoice_id: header.invoice_id });
    const derived = charges.reduce((s: number, c: any) => s + Number(c.net_amount) + Number(c.tax_amount), 0);
    expect(charges.length).toBeGreaterThan(0);
    expect(Number(header.total_amount)).toBe(Math.round(derived));
  });

  it("a client_id belonging to another tenant is a 400 and creates nothing in either tenant", async () => {
    const otherTenant = uuidv4();
    const otherClient = uuidv4();
    await context.db('tenants').insert({
      tenant: otherTenant,
      client_name: `Other Tenant ${otherTenant.slice(0, 6)}`,
      email: `${otherTenant.slice(0, 6)}@example.com`,
    });
    await context.db('clients').insert({
      tenant: otherTenant,
      client_id: otherClient,
      client_name: `Other Client ${otherClient.slice(0, 6)}`,
    });

    const error = await serviceUnderTest()
      .create({ ...base(), client_id: otherClient } as any, ctx())
      .then(() => null, (e) => e);
    expect(error).toMatchObject({ statusCode: 400, message: expect.stringContaining('client') });
    expect(handleApiError(error).status).toBe(400);
    expect(await invoiceCount()).toBe(baselineCount);
    expect(Number((await context.db('invoices').where({ client_id: otherClient }).count('* as n').first())?.n)).toBe(0);
  });
});
