import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  inserted: [] as any[],
  hasPermission: vi.fn(async () => true),
  // client_id -> owning tenant
  clients: new Map<string, string>(),
  calculateAndDistributeTax: vi.fn(),
  recomputeInvoiceHeaderTotals: vi.fn(),
}));

vi.mock('@alga-psa/billing/services/invoiceService', async (importOriginal) => {
  const actual: any = await importOriginal();
  return {
    ...actual,
    getClientDetails: vi.fn(async () => ({ client_id: 'client-1' })),
    calculateAndDistributeTax: mocks.calculateAndDistributeTax,
    recomputeInvoiceHeaderTotals: mocks.recomputeInvoiceHeaderTotals,
  };
});

vi.mock('@alga-psa/db', async (importOriginal) => {
  const actual: any = await importOriginal();
  const builder = (tenant: string, table: string) => {
    let where: Record<string, unknown> = {};
    const b: any = {
      where: (w: Record<string, unknown>) => {
        where = w;
        return b;
      },
      first: async () =>
        table === 'clients' && mocks.clients.get(where.client_id as string) === tenant
          ? { client_id: where.client_id }
          : undefined,
      insert: (row: any) => {
        mocks.inserted.push(row);
        return b;
      },
      returning: async () => [{ ...mocks.inserted[mocks.inserted.length - 1] }],
    };
    return b;
  };
  return {
    ...actual,
    withTransaction: async (_knex: unknown, cb: (trx: unknown) => unknown) => cb({}),
    tenantDb: (_trx: unknown, tenant: string) => ({ table: (table: string) => builder(tenant, table) }),
  };
});

vi.mock('../../../lib/auth/rbac', () => ({ hasPermission: mocks.hasPermission }));
vi.mock('../../../lib/logging/auditLog', () => ({ auditLog: vi.fn() }));
vi.mock('../../../lib/eventBus/publishers', () => ({
  publishEvent: vi.fn(),
  publishUnregisteredEventType: vi.fn(),
  publishWorkflowEvent: vi.fn(),
}));
vi.mock('@alga-psa/billing/actions/invoiceGeneration', async (importOriginal) => {
  const actual: any = await importOriginal();
  return { ...actual, generateInvoiceNumber: async () => 'INV-1' };
});

vi.mock('@alga-psa/billing/lib/billing/invoiceDueDate', async (importOriginal) => {
  const actual: any = await importOriginal();
  return {
    ...actual,
    resolveInvoiceBillingTerms: async () => ({ dueDate: '2026-02-01', paymentMethod: null, billingProfileId: null }),
  };
});

import { InvoiceService } from '../../../lib/api/services/InvoiceService';

describe('InvoiceService.create is draft-only', () => {
  const context = { tenant: 'tenant-1', userId: 'user-1', user: { user_id: 'user-1', user_type: 'internal' } } as any;
  let service: InvoiceService;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.inserted.length = 0;
    mocks.hasPermission.mockResolvedValue(true);
    mocks.clients.clear();
    mocks.clients.set('client-1', 'tenant-1');
    mocks.clients.set('client-other', 'tenant-2');
    service = new InvoiceService();
    vi.spyOn(service as any, 'getKnex').mockResolvedValue({ knex: {} });
    vi.spyOn(service as any, 'filterAuditFields').mockImplementation(async (_t: any, d: any) => d);
    vi.spyOn(service as any, 'createInvoiceLineItems').mockResolvedValue(undefined);
    vi.spyOn(service as any, 'assertBillingProfileBelongsToClient').mockResolvedValue(undefined);
    vi.spyOn(service, 'getById').mockResolvedValue({ invoice_id: 'x' } as any);
  });

  it.each([
    [{ status: 'sent' }, 'status'],
    [{ status: 'paid' }, 'status'],
    [{ credit_applied: 25 }, 'credit_applied'],
    [{ billing_cycle_id: '11111111-1111-4111-8111-111111111111' }, 'billing_cycle_id'],
  ])('rejects %j with a 400 naming %s and writes nothing', async (body, field) => {
    await expect(service.create({ client_id: 'client-1', ...body } as any, context)).rejects.toMatchObject({
      statusCode: 400,
      message: expect.stringContaining(field),
    });
    expect(mocks.inserted).toHaveLength(0);
  });

  it.each([
    [{ status: 'draft', credit_applied: 0 }],
    [{ status: 'draft' }],
    [{ credit_applied: 0 }],
    [{}],
  ])('accepts %j', async (body) => {
    await service.create({ client_id: 'client-1', due_date: '2026-01-01', ...body } as any, context);
    expect(mocks.inserted).toHaveLength(1);
    expect(mocks.inserted[0]).toMatchObject({ status: 'draft', credit_applied: 0, tenant: 'tenant-1' });
  });

  it('never persists caller-supplied header totals and forces the tenant', async () => {
    await service.create(
      { client_id: 'client-1', due_date: '2026-01-01', subtotal: 999, tax: 99, total_amount: 1098, tenant: 'evil' } as any,
      context,
    );
    expect(mocks.inserted[0]).toMatchObject({ subtotal: 0, tax: 0, total_amount: 0, tenant: 'tenant-1' });
  });

  it('derives totals through the billing engine helpers when items are present', async () => {
    await service.create(
      { client_id: 'client-1', due_date: '2026-01-01', total_amount: 5, items: [{ description: 'x', quantity: 1, unit_price: 100 }] } as any,
      context,
    );
    expect(mocks.calculateAndDistributeTax).toHaveBeenCalledTimes(1);
    expect(mocks.recomputeInvoiceHeaderTotals).toHaveBeenCalledTimes(1);
  });
});

describe('InvoiceService.create authorization', () => {
  const user = { user_id: 'user-1', user_type: 'internal' };
  const context = { tenant: 'tenant-1', userId: 'user-1', user } as any;
  let service: InvoiceService;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.inserted.length = 0;
    mocks.hasPermission.mockResolvedValue(true);
    mocks.clients.clear();
    mocks.clients.set('client-1', 'tenant-1');
    mocks.clients.set('client-other', 'tenant-2');
    service = new InvoiceService();
    vi.spyOn(service as any, 'getKnex').mockResolvedValue({ knex: {} });
    vi.spyOn(service as any, 'filterAuditFields').mockImplementation(async (_t: any, d: any) => d);
    vi.spyOn(service as any, 'createInvoiceLineItems').mockResolvedValue(undefined);
    vi.spyOn(service, 'getById').mockResolvedValue({ invoice_id: 'x' } as any);
  });

  it('an authorized caller creates an invoice for a client in its own tenant', async () => {
    await service.create({ client_id: 'client-1', due_date: '2026-01-01' } as any, context);
    expect(mocks.hasPermission).toHaveBeenCalledWith(user, 'invoice', 'create', expect.anything());
    expect(mocks.inserted).toHaveLength(1);
    expect(mocks.inserted[0]).toMatchObject({ client_id: 'client-1', tenant: 'tenant-1', status: 'draft' });
  });

  it('a caller without invoice:create is refused with a 403 and nothing is written', async () => {
    mocks.hasPermission.mockResolvedValue(false);
    await expect(
      service.create({ client_id: 'client-1', due_date: '2026-01-01' } as any, context),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(mocks.inserted).toHaveLength(0);
  });

  it('a context without a user is refused with a 403 (a bare userId is not enough)', async () => {
    await expect(
      service.create({ client_id: 'client-1', due_date: '2026-01-01' } as any, { tenant: 'tenant-1', userId: 'user-1' } as any),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(mocks.inserted).toHaveLength(0);
  });

  it.each([['client-other'], ['client-missing']])(
    "naming a client outside the caller's tenant (%s) is a 400 and nothing is written",
    async (clientId) => {
      await expect(
        service.create({ client_id: clientId, due_date: '2026-01-01' } as any, context),
      ).rejects.toMatchObject({ statusCode: 400, message: expect.stringContaining('client') });
      expect(mocks.inserted).toHaveLength(0);
    },
  );
});
