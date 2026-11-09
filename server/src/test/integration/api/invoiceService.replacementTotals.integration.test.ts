import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { TestContext } from '../../../../test-utils/testContext';
import { ensureDefaultBillingSettings, setupClientTaxConfiguration } from '../../../../test-utils/billingTestHelpers';

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
vi.mock('@alga-psa/auth/rbac', () => ({ hasPermission: vi.fn(() => Promise.resolve(true)) }));
vi.mock('@/lib/auth/rbac', () => ({ hasPermission: vi.fn(() => Promise.resolve(true)) }));

import { setupCommonMocks } from '../../../../test-utils/testMocks';
import { ApiInvoiceController } from '@/lib/api/controllers/ApiInvoiceController';
import { InvoiceService } from '@/lib/api/services/InvoiceService';

const { beforeAll: setupContext, beforeEach: resetContext, afterEach: rollbackContext, afterAll: cleanupContext } =
  TestContext.createHelpers();

describe('InvoiceService.update replacement totals', () => {
  let context: TestContext;

  beforeAll(async () => {
    context = await setupContext({ runSeeds: false });
  }, 120000);

  beforeEach(async () => {
    context = await resetContext();
    setupCommonMocks({ tenantId: context.tenantId, userId: context.userId, permissionCheck: () => true });
    await ensureDefaultBillingSettings(context);
    await context.db('clients').where({ tenant: context.tenantId, client_id: context.clientId })
      .update({ region_code: 'US-NY', is_tax_exempt: false });
    await setupClientTaxConfiguration(context, { regionCode: 'US-NY', taxPercentage: 6 });
  }, 30000);

  afterEach(async () => rollbackContext(), 30000);
  afterAll(async () => cleanupContext(), 120000);

  const service = () => {
    const instance = new InvoiceService();
    vi.spyOn(instance as any, 'getKnex').mockResolvedValue({ knex: context.db, tenant: context.tenantId });
    return instance;
  };

  const serviceContext = () => ({
    tenant: context.tenantId,
    userId: context.userId,
    user: { user_id: context.userId, user_type: 'internal' },
  } as any);

  class TestInvoiceController extends ApiInvoiceController {
    protected async authenticate(req: NextRequest) {
      return Object.assign(req, { context: serviceContext() }) as any;
    }

    protected async checkPermission(_req: any, action: string) {
      expect(action).toBe('update');
    }

    protected runWithApiKeyContext<T>(_req: any, callback: () => Promise<T>): Promise<T> {
      return callback();
    }
  }

  function update(invoiceId: string, items: unknown[]) {
    const controller = new TestInvoiceController();
    vi.spyOn((controller as any).invoiceService, 'getKnex')
      .mockResolvedValue({ knex: context.db, tenant: context.tenantId });
    const request = new NextRequest(`http://localhost/api/v1/invoices/${invoiceId}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ items }),
    });
    (request as any).params = Promise.resolve({ id: invoiceId });
    return controller.update()(request);
  }

  async function createDraft() {
    return service().create({
      client_id: context.clientId,
      invoice_date: '2026-03-01',
      due_date: '2026-03-31',
      items: [{ description: 'original', quantity: 2, unit_price: 1000, rate: 1000, tax_amount: 0 }],
    } as any, serviceContext());
  }

  it('persists replacement engine taxes and totals in the update response and subsequent reads', async () => {
    const original = await createDraft();
    expect([Number(original.subtotal), Number(original.tax), Number(original.total_amount)]).toEqual([2000, 120, 2120]);

    const response = await update(original.invoice_id, [
      { description: 'replacement', quantity: 3, unit_price: 400, rate: 400, tax_amount: 0 },
    ]);

    expect(response.status).toBe(200);
    const { data } = await response.json();
    const charges = await context.db('invoice_charges')
      .where({ tenant: context.tenantId, invoice_id: original.invoice_id });
    expect(charges).toHaveLength(1);
    expect(Number(charges[0].net_amount)).toBe(1200);
    expect(Number(charges[0].tax_amount)).toBe(72);
    expect(data.invoice_charges).toHaveLength(1);
    expect(Number(data.invoice_charges[0].tax_amount)).toBe(72);
    expect([Number(data.subtotal), Number(data.tax), Number(data.total_amount)]).toEqual([1200, 72, 1272]);

    const persistedHeader = await context.db('invoices')
      .where({ tenant: context.tenantId, invoice_id: original.invoice_id }).first();
    const subsequentRead = await service().getById(original.invoice_id, serviceContext()) as any;
    expect([Number(persistedHeader.subtotal), Number(persistedHeader.tax), Number(persistedHeader.total_amount)])
      .toEqual([1200, 72, 1272]);
    expect([Number(subsequentRead.subtotal), Number(subsequentRead.tax), Number(subsequentRead.total_amount)])
      .toEqual([1200, 72, 1272]);
    expect(Number(subsequentRead.invoice_charges[0].tax_amount)).toBe(72);
    expect(Number(charges[0].tax_amount)).not.toBe(0);
    expect(Number(charges[0].tax_amount)).not.toBe(120);
  });

  it('clearing items removes charges and resets all calculated header totals', async () => {
    const original = await createDraft();
    const response = await update(original.invoice_id, []);

    expect(response.status).toBe(200);
    const { data } = await response.json();
    expect(await context.db('invoice_charges').where({ tenant: context.tenantId, invoice_id: original.invoice_id }))
      .toHaveLength(0);
    expect([Number(data.subtotal), Number(data.tax), Number(data.total_amount)]).toEqual([0, 0, 0]);
    const persistedHeader = await context.db('invoices')
      .where({ tenant: context.tenantId, invoice_id: original.invoice_id }).first();
    expect([Number(persistedHeader.subtotal), Number(persistedHeader.tax), Number(persistedHeader.total_amount)])
      .toEqual([0, 0, 0]);
  });

  it('rejects malformed replacements before changing charges or header totals', async () => {
    const original = await createDraft();
    const beforeHeader = await context.db('invoices')
      .where({ tenant: context.tenantId, invoice_id: original.invoice_id }).first();
    const beforeCharges = await context.db('invoice_charges')
      .where({ tenant: context.tenantId, invoice_id: original.invoice_id })
      .select('item_id', 'description', 'net_amount', 'tax_amount', 'total_price');

    const response = await update(original.invoice_id, [{}]);

    expect(response.status).toBe(400);
    const afterHeader = await context.db('invoices')
      .where({ tenant: context.tenantId, invoice_id: original.invoice_id }).first();
    const afterCharges = await context.db('invoice_charges')
      .where({ tenant: context.tenantId, invoice_id: original.invoice_id })
      .select('item_id', 'description', 'net_amount', 'tax_amount', 'total_price');
    expect([afterHeader.subtotal, afterHeader.tax, afterHeader.total_amount])
      .toEqual([beforeHeader.subtotal, beforeHeader.tax, beforeHeader.total_amount]);
    expect(afterCharges).toEqual(beforeCharges);
  });
});
