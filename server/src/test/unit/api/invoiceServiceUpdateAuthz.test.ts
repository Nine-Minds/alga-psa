import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  assertInvoiceNotExported: vi.fn(),
  invoiceUpdate: vi.fn(),
  existing: { invoice_id: 'inv-1', status: 'draft', client_id: 'client-1', due_date: '2026-01-01' } as any,
}));

vi.mock('@alga-psa/billing/services/accountingSync/invoiceExportGuards', () => ({
  assertInvoiceNotExported: mocks.assertInvoiceNotExported,
}));

vi.mock('@alga-psa/db', async (importOriginal) => {
  const actual: any = await importOriginal();
  const builder = (table: string) => {
    const b: any = {
      where: () => b,
      forUpdate: () => b,
      first: async () => (table === 'invoices' ? mocks.existing : undefined),
      update: async (data: any) => {
        if (table === 'invoices') mocks.invoiceUpdate(data);
        return 1;
      },
      pluck: async () => [],
    };
    return b;
  };
  return {
    ...actual,
    withTransaction: async (_knex: unknown, cb: (trx: unknown) => unknown) => cb({}),
    tenantDb: () => ({ table: builder }),
  };
});

vi.mock('../../../lib/logging/auditLog', () => ({ auditLog: vi.fn() }));
vi.mock('../../../lib/eventBus/publishers', () => ({
  publishEvent: vi.fn(),
  publishUnregisteredEventType: vi.fn(),
  publishWorkflowEvent: vi.fn(),
}));

import { InvoiceService } from '../../../lib/api/services/InvoiceService';

describe('InvoiceService.update authorization boundary', () => {
  const context = { tenant: 'tenant-1', userId: 'user-1' } as any;
  let service: InvoiceService;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.existing = { invoice_id: 'inv-1', status: 'draft', client_id: 'client-1', due_date: '2026-01-01' };
    mocks.assertInvoiceNotExported.mockResolvedValue(undefined);
    service = new InvoiceService();
    vi.spyOn(service as any, 'validatePermissions').mockResolvedValue(undefined);
    vi.spyOn(service as any, 'getKnex').mockResolvedValue({ knex: {} });
    vi.spyOn(service as any, 'addUpdateAuditFields').mockImplementation(async (_t: any, d: any) => ({ ...d }));
    vi.spyOn(service as any, 'getInvoiceRecurringProvenance').mockResolvedValue(null);
    vi.spyOn(service, 'getById').mockResolvedValue({ invoice_id: 'inv-1' } as any);
  });

  it.each([
    [{ status: 'paid' }, 'status'],
    [{ total_amount: 0 }, 'total_amount'],
    [{ client_id: 'other' }, 'client_id'],
    [{ tenant: 'other' }, 'tenant'],
    [{ bogus: 1 }, 'bogus'],
  ])('rejects %j with a 400 naming the field and writes nothing', async (body, field) => {
    await expect(service.update('inv-1', body as any, context)).rejects.toMatchObject({
      statusCode: 400,
      message: expect.stringContaining(field),
    });
    expect(mocks.invoiceUpdate).not.toHaveBeenCalled();
    expect(mocks.assertInvoiceNotExported).not.toHaveBeenCalled();
  });

  it('rejects an allowlisted edit on an exported invoice with 409 and writes nothing', async () => {
    mocks.assertInvoiceNotExported.mockRejectedValue(new Error('Invoice already exported'));
    await expect(service.update('inv-1', { due_date: '2026-02-01' } as any, context)).rejects.toMatchObject({
      statusCode: 409,
    });
    expect(mocks.assertInvoiceNotExported).toHaveBeenCalledWith(expect.anything(), 'tenant-1', 'inv-1', 'edit');
    expect(mocks.invoiceUpdate).not.toHaveBeenCalled();
  });

  it('refuses date edits on a non-draft invoice', async () => {
    mocks.existing = { ...mocks.existing, status: 'sent' };
    await expect(service.update('inv-1', { due_date: '2026-02-01' } as any, context)).rejects.toMatchObject({
      statusCode: 409,
    });
    expect(mocks.invoiceUpdate).not.toHaveBeenCalled();
  });

  it('still applies a legal draft edit', async () => {
    await expect(service.update('inv-1', { due_date: '2026-02-01' } as any, context)).resolves.toBeDefined();
    expect(mocks.invoiceUpdate).toHaveBeenCalledWith(expect.objectContaining({ due_date: '2026-02-01' }));
  });
});
