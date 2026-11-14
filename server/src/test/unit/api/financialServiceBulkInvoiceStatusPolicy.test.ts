import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  writes: [] as Array<{ table: string; op: string; data?: any }>,
}));

vi.mock('@alga-psa/db', async (importOriginal) => {
  const actual = await importOriginal<any>();
  const makeChain = (table: string) => {
    const chain: any = {
      where: () => chain,
      first: async () => undefined,
      returning: async () => [],
      update: (data: any) => { h.writes.push({ table, op: 'update', data }); return chain; },
      insert: (data: any) => { h.writes.push({ table, op: 'insert', data }); return chain; },
    };
    return chain;
  };
  return {
    ...actual,
    tenantDb: () => ({ table: (table: string) => makeChain(table) }),
    withTransaction: async (_knex: any, callback: any) => callback({}),
  };
});
vi.mock('../../../lib/logging/auditLog', () => ({ auditLog: vi.fn() }));

import { FinancialService } from '../../../lib/api/services/FinancialService';
import { InvoiceService } from '../../../lib/api/services/InvoiceService';

const context = { tenant: 'tenant-1', userId: 'user-1' } as any;
const ID = '11111111-1111-4111-8111-111111111111';

function makeService() {
  const service = new FinancialService();
  vi.spyOn(service as any, 'getKnex').mockResolvedValue({ knex: {}, tenant: 'tenant-1' });
  vi.spyOn(service as any, 'validatePermissions').mockResolvedValue(undefined);
  return service;
}

describe('FinancialService.bulkInvoiceOperation canonical dispatch', () => {
  beforeEach(() => {
    h.writes.length = 0;
    vi.restoreAllMocks();
  });

  it.each([
    ['finalize', 'finalizeInvoice', 'sent', 'finalized'],
    ['cancel', 'voidInvoice', 'cancelled', 'voided'],
  ] as const)(
    '%s returns the canonical invoice result without writing invoice state itself',
    async (operation, command, status, outcome) => {
      const canonicalResult = { invoice_id: ID, status, finalized_at: null };
      const canonicalCommand = vi.spyOn(InvoiceService.prototype, command).mockResolvedValue(canonicalResult as any);

      const { data } = await makeService().bulkInvoiceOperation(
        { operation, invoice_ids: [ID] } as any,
        context,
      );

      expect(canonicalCommand).toHaveBeenCalledWith(
        ...(operation === 'finalize' ? [{ invoice_id: ID }, context] : [ID, context, {}]),
      );
      expect(data).toMatchObject({
        total_requested: 1,
        successful: 1,
        failed: 0,
        results: [{ id: ID, success: true, outcome, result: canonicalResult }],
      });
      expect(h.writes.filter((write) => write.table === 'invoices')).toEqual([]);
    },
  );
});
