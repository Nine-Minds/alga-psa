import { describe, expect, it, vi } from 'vitest';

const { deleteCalls } = vi.hoisted(() => ({
  deleteCalls: [] as Array<{ table: string; where: Record<string, unknown> }>,
}));

vi.mock('@alga-psa/db', () => ({
  tenantDb: (_conn: unknown, _tenant: string) => ({
    table: (table: string) => ({
      where: (where: Record<string, unknown>) => ({
        del: async () => {
          deleteCalls.push({ table, where });
          return 1;
        },
      }),
    }),
  }),
}));

vi.mock('@alga-psa/core/server', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  deleteEntityWithValidation: async (
    _entityType: string,
    _entityId: string,
    _knex: unknown,
    tenant: string,
    performDelete: (trx: unknown, tenant: string) => Promise<void>
  ) => {
    await performDelete({}, tenant);
    return { canDelete: true, dependencies: [], alternatives: [], deleted: true };
  },
}));

import Quote from '../../src/models/quote';

describe('Quote.delete', () => {
  it('deletes quote_activities explicitly before the quote row', async () => {
    const result = await Quote.delete({} as never, 'tenant-1', 'quote-1');

    expect(result).toMatchObject({ deleted: true });
    expect(deleteCalls).toEqual([
      { table: 'quote_activities', where: { quote_id: 'quote-1' } },
      { table: 'quotes', where: { quote_id: 'quote-1' } },
    ]);
  });
});
