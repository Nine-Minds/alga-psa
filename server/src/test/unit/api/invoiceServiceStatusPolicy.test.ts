import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  rows: {} as Record<string, any>,
  writes: [] as Array<{ table: string; op: string; data?: any }>,
}));

vi.mock('@alga-psa/db', async (importOriginal) => {
  const actual = await importOriginal<any>();
  const makeChain = (table: string) => {
    const chain: any = {
      where: () => chain,
      whereIn: () => chain,
      select: () => chain,
      orderBy: () => chain,
      first: async () => (table === 'invoices' ? h.rows.invoice : undefined),
      pluck: async () => [],
      update: async (data: any) => { h.writes.push({ table, op: 'update', data }); return 1; },
      insert: async (data: any) => { h.writes.push({ table, op: 'insert', data }); return [1]; },
      del: async () => { h.writes.push({ table, op: 'del' }); return 1; },
    };
    return chain;
  };
  return {
    ...actual,
    tenantDb: () => ({ table: (t: string) => makeChain(t) }),
    withTransaction: async (_knex: any, cb: any) => cb({}),
  };
});
vi.mock('../../../lib/logging/auditLog', () => ({ auditLog: vi.fn() }));
vi.mock('../../../lib/eventBus/publishers', () => ({
  publishEvent: vi.fn(),
  publishUnregisteredEventType: vi.fn(),
  publishWorkflowEvent: vi.fn(),
}));

import { InvoiceService } from '../../../lib/api/services/InvoiceService';
import { ConflictError } from '../../../lib/api/middleware/apiMiddleware';

const context = { tenant: 'tenant-1', userId: 'user-1' } as any;
const ID = '11111111-1111-4111-8111-111111111111';

function makeService() {
  const service = new InvoiceService();
  vi.spyOn(service as any, 'getKnex').mockResolvedValue({ knex: {}, tenant: 'tenant-1' });
  vi.spyOn(service as any, 'addUpdateAuditFields').mockImplementation(async (_t: any, d: any) => ({ ...d, updated_at: 'now' }));
  vi.spyOn(service as any, 'filterAuditFields').mockImplementation(async (_t: any, d: any) => d);
  vi.spyOn(service as any, 'getInvoiceRecurringProvenance').mockResolvedValue(null);
  vi.spyOn(service as any, 'getInvoiceAmountDue').mockResolvedValue(0);
  vi.spyOn(service, 'getById').mockResolvedValue({ invoice_id: ID } as any);
  return service;
}

const invoiceWrites = () => h.writes.filter((w) => w.table === 'invoices' && w.op === 'update');

describe('InvoiceService.update status policy', () => {
  beforeEach(() => {
    h.writes.length = 0;
    h.rows.invoice = { invoice_id: ID, status: 'draft', client_id: 'c', due_date: '2026-01-01', total_amount: 100, credit_applied: 0 };
  });

  it('cancelled is refused with 409 naming void and invoice:void; nothing written', async () => {
    const err: any = await makeService().update(ID, { status: 'cancelled' } as any, context).catch((e) => e);
    expect(err).toBeInstanceOf(ConflictError);
    expect(err.statusCode).toBe(409);
    expect(err.message).toContain('void');
    expect(err.message).toContain('invoice:void');
    expect(h.writes).toEqual([]);
  });

  it('paid is refused and creates no invoice_payments row or invoice write', async () => {
    h.rows.invoice.status = 'sent';
    const err: any = await makeService().update(ID, { status: 'paid' } as any, context).catch((e) => e);
    expect(err).toBeInstanceOf(ConflictError);
    expect(err.message).toContain('recordPayment');
    expect(err.message).toContain('invoice:payment');
    expect(h.writes.filter((w) => w.table === 'invoice_payments')).toEqual([]);
    expect(invoiceWrites()).toEqual([]);
  });

  it('draft -> sent is refused (finalize owns it)', async () => {
    const err: any = await makeService().update(ID, { status: 'sent' } as any, context).catch((e) => e);
    expect(err.message).toContain('finalizeInvoice');
    expect(h.writes).toEqual([]);
  });

  it('plain transition still succeeds and writes the status', async () => {
    h.rows.invoice.status = 'sent';
    await makeService().update(ID, { status: 'partially_applied' } as any, context);
    expect(invoiceWrites()).toHaveLength(1);
    expect(invoiceWrites()[0].data.status).toBe('partially_applied');
  });

  it('finalized_at and credit_applied never reach the write', async () => {
    h.rows.invoice.status = 'sent';
    await makeService().update(ID, { status: 'overdue', finalized_at: '2026-01-01', credit_applied: 50 } as any, context);
    const data = invoiceWrites()[0].data;
    expect(data).not.toHaveProperty('finalized_at');
    expect(data).not.toHaveProperty('credit_applied');
  });

  it('paid invoices cannot change status', async () => {
    h.rows.invoice.status = 'paid';
    await expect(makeService().update(ID, { status: 'overdue' } as any, context)).rejects.toThrow('Cannot modify paid invoice status');
    expect(h.writes).toEqual([]);
  });
});

describe('InvoiceService.bulkUpdateStatus status policy', () => {
  beforeEach(() => {
    h.writes.length = 0;
    h.rows.invoice = { invoice_id: ID, status: 'sent', client_id: 'c', due_date: '2026-01-01', total_amount: 100, credit_applied: 0 };
  });

  it.each(['paid', 'cancelled'] as const)('-> %s becomes a per-invoice error and nothing is written', async (status) => {
    const result = await makeService().bulkUpdateStatus({ invoice_ids: [ID], status } as any, context);
    expect(result.updated_count).toBe(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatch(status === 'paid' ? /recordPayment.*invoice:payment/ : /void.*invoice:void/);
    expect(h.writes.filter((w) => w.op !== 'insert')).toEqual([]);
  });

  it('plain transition applies without finalized_at', async () => {
    const result = await makeService().bulkUpdateStatus({ invoice_ids: [ID], status: 'overdue' } as any, context);
    expect(result.updated_count).toBe(1);
    const data = invoiceWrites()[0].data;
    expect(data.status).toBe('overdue');
    expect(data).not.toHaveProperty('finalized_at');
  });
});
