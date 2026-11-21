import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  hasPermission: vi.fn(),
  finalizeInvoice: vi.fn(),
  voidInvoice: vi.fn(),
  auditLog: vi.fn(),
}));

vi.mock('../../../lib/auth/rbac', () => ({ hasPermission: mocks.hasPermission }));
vi.mock('@alga-psa/db', async (importOriginal) => ({
  ...await importOriginal<typeof import('@alga-psa/db')>(),
  withTransaction: async (_knex: unknown, callback: (trx: unknown) => unknown) => callback({}),
}));
vi.mock('../../../lib/api/services/InvoiceService', () => ({
  InvoiceService: class {
    finalizeInvoice = mocks.finalizeInvoice;
    voidInvoice = mocks.voidInvoice;
  },
}));
vi.mock('../../../lib/logging/auditLog', () => ({ auditLog: mocks.auditLog }));

import { FinancialService } from '../../../lib/api/services/FinancialService';
import { ConflictError } from '../../../lib/api/middleware/apiMiddleware';

describe('FinancialService bulk invoice lifecycle authorization', () => {
  let service: FinancialService;
  const context = {
    tenant: 'tenant-1',
    userId: '11111111-1111-4111-8111-111111111112',
    user: { user_id: '11111111-1111-4111-8111-111111111112', user_type: 'internal' },
  } as any;
  const invoiceId = '11111111-1111-4111-8111-111111111111';

  beforeEach(() => {
    vi.clearAllMocks();
    service = new FinancialService();
    vi.spyOn(service as any, 'getKnex').mockResolvedValue({ knex: {} });
    mocks.auditLog.mockResolvedValue(undefined);
    mocks.finalizeInvoice.mockResolvedValue({ status: 'finalized' });
    mocks.voidInvoice.mockResolvedValue({ status: 'void' });
  });

  it('does not invoke either lifecycle engine when update is granted without finalize', async () => {
    mocks.hasPermission.mockImplementation(async (_user: unknown, _resource: string, action: string) => action === 'update');

    await expect(service.bulkInvoiceOperation({ invoice_ids: [invoiceId], operation: 'finalize' } as any, context))
      .rejects.toThrow(/Permission denied/);

    expect(mocks.finalizeInvoice).not.toHaveBeenCalled();
    expect(mocks.voidInvoice).not.toHaveBeenCalled();
  });

  it('does not invoke either lifecycle engine when only void is granted without update', async () => {
    mocks.hasPermission.mockImplementation(async (_user: unknown, _resource: string, action: string) => action === 'void');

    await expect(service.bulkInvoiceOperation({ invoice_ids: [invoiceId], operation: 'cancel' } as any, context))
      .rejects.toThrow(/Permission denied/);

    expect(mocks.finalizeInvoice).not.toHaveBeenCalled();
    expect(mocks.voidInvoice).not.toHaveBeenCalled();
  });

  it('does not invoke cancel when update is granted without void', async () => {
    mocks.hasPermission.mockImplementation(async (_user: unknown, _resource: string, action: string) => action === 'update');

    await expect(service.bulkInvoiceOperation({ invoice_ids: [invoiceId], operation: 'cancel' } as any, context))
      .rejects.toThrow(/Permission denied/);

    expect(mocks.voidInvoice).not.toHaveBeenCalled();
  });

  it('routes finalize through the canonical engine and requires finalize independently of void', async () => {
    mocks.hasPermission.mockImplementation(async (_user: unknown, resource: string, action: string) =>
      resource === 'invoice' && (action === 'update' || action === 'finalize'));

    const result = await service.bulkInvoiceOperation({ invoice_ids: [invoiceId], operation: 'finalize' } as any, context);

    expect(result.data).toMatchObject({ successful: 1, failed: 0 });
    expect(mocks.finalizeInvoice).toHaveBeenCalledWith({ invoice_id: invoiceId }, context);
    expect(mocks.voidInvoice).not.toHaveBeenCalled();
  });

  it('routes cancel through the canonical void action and requires void independently of finalize', async () => {
    mocks.hasPermission.mockImplementation(async (_user: unknown, resource: string, action: string) =>
      resource === 'invoice' && (action === 'update' || action === 'void'));

    const result = await service.bulkInvoiceOperation({ invoice_ids: [invoiceId], operation: 'cancel' } as any, context);

    expect(result.data).toMatchObject({ successful: 1, failed: 0 });
    expect(mocks.voidInvoice).toHaveBeenCalledWith(invoiceId, context, {});
    expect(mocks.finalizeInvoice).not.toHaveBeenCalled();
  });

  it('returns canonical lifecycle guard failures as per-invoice failures', async () => {
    mocks.hasPermission.mockResolvedValue(true);
    mocks.voidInvoice.mockRejectedValue(new ConflictError('Unwind payments before voiding.'));

    const result = await service.bulkInvoiceOperation({ invoice_ids: [invoiceId], operation: 'cancel' } as any, context);

    expect(result.data).toMatchObject({ successful: 0, failed: 1 });
    expect(result.data.results[0]).toMatchObject({ success: false, error: 'Unwind payments before voiding.' });
  });

  it('rejects placeholder operations before any lifecycle mutation', async () => {
    mocks.hasPermission.mockResolvedValue(true);

    await expect(service.bulkInvoiceOperation({ invoice_ids: [invoiceId], operation: 'send' } as any, context))
      .rejects.toThrow(/Unsupported operation/);

    expect(mocks.finalizeInvoice).not.toHaveBeenCalled();
    expect(mocks.voidInvoice).not.toHaveBeenCalled();
  });
});
