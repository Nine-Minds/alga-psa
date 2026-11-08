import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  status: 'draft' as string | undefined,
  writes: [] as Array<{ table: string; op: string; data?: any }>,
}));

vi.mock('@alga-psa/db', async (importOriginal) => {
  const actual = await importOriginal<any>();
  const makeChain = (table: string) => {
    const chain: any = {
      where: () => chain,
      first: async () => (table === 'invoices' && h.status ? { invoice_id: 'x', status: h.status } : undefined),
      returning: async () => [],
      update: (data: any) => { h.writes.push({ table, op: 'update', data }); return chain; },
      insert: (data: any) => { h.writes.push({ table, op: 'insert', data }); return chain; },
    };
    return chain;
  };
  return {
    ...actual,
    tenantDb: () => ({ table: (t: string) => makeChain(t) }),
    withTransaction: async (_k: any, cb: any) => cb({}),
  };
});
vi.mock('../../../lib/logging/auditLog', () => ({ auditLog: vi.fn() }));

import { FinancialService } from '../../../lib/api/services/FinancialService';

const context = { tenant: 'tenant-1', userId: 'user-1' } as any;
const ID = '11111111-1111-4111-8111-111111111111';

function makeService() {
  const service = new FinancialService();
  vi.spyOn(service as any, 'getKnex').mockResolvedValue({ knex: {}, tenant: 'tenant-1' });
  vi.spyOn(service as any, 'validatePermissions').mockResolvedValue(undefined);
  return service;
}

const invoiceWrites = () => h.writes.filter((w) => w.table === 'invoices');

describe('FinancialService.bulkInvoiceOperation status policy', () => {
  beforeEach(() => { h.writes.length = 0; h.status = 'draft'; });

  it.each([
    ['cancel', 'draft', /void.*invoice:void/],
    ['cancel', 'paid', /Cannot modify paid invoice status/],
    ['finalize', 'draft', /finalizeInvoice.*invoice:finalize/],
    ['finalize', 'paid', /Cannot modify paid invoice status/],
    ['finalize', 'pending', /finalizeInvoice.*invoice:finalize/],
  ])('%s on a %s invoice writes nothing and returns a per-invoice error', async (operation, status, pattern) => {
    h.status = status;
    const { data } = await makeService().bulkInvoiceOperation({ operation, invoice_ids: [ID] } as any, context);
    expect(data.successful).toBe(0);
    expect(data.results[0].success).toBe(false);
    expect(data.results[0].error).toMatch(pattern);
    expect(invoiceWrites()).toEqual([]);
  });

  it('missing invoice is a per-invoice error with no write', async () => {
    h.status = undefined;
    const { data } = await makeService().bulkInvoiceOperation({ operation: 'cancel', invoice_ids: [ID] } as any, context);
    expect(data.results[0].success).toBe(false);
    expect(invoiceWrites()).toEqual([]);
  });
});
