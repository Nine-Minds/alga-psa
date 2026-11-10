import { afterAll, describe, expect, it, vi } from 'vitest';
import knexFactory from 'knex';

vi.mock('@alga-psa/auth', () => ({ withAuth: (action: unknown) => action }));
vi.mock('@alga-psa/auth/rbac', () => ({ hasPermission: vi.fn() }));

import { getInvoiceLineCogsForTenant } from '../../../../../packages/billing/src/actions/invoiceCogsActions';

const knex = knexFactory({ client: 'pg' });

afterAll(async () => {
  await knex.destroy();
});

describe('invoice COGS source isolation', () => {
  it('scopes matching materials and movements to the invoice tenant and subtracts restocks', async () => {
    const result = knex.raw('select 1');
    Object.defineProperty(result, 'then', {
      value: (resolve: (value: { rows: unknown[] }) => unknown, reject: (error: unknown) => unknown) =>
        Promise.resolve({ rows: [] }).then(resolve, reject),
    });
    const raw = vi.spyOn(knex, 'raw').mockReturnValueOnce(result);

    await expect(getInvoiceLineCogsForTenant(knex, 'tenant-1', 'invoice-1')).resolves.toEqual([]);

    const [sql, bindings] = raw.mock.calls[0];
    expect(sql).toContain('ON nm.tenant = il.tenant');
    expect(sql).toContain('AND nm.invoice_id = il.invoice_id');
    expect(sql).toContain('ON sm.tenant = il.tenant');
    expect(sql).toContain('AND sm.source_doc_type = nm.source_doc_type');
    expect(sql).toContain('AND sm.source_doc_id = nm.source_doc_id');
    expect(sql).toMatch(/WHEN sm\.movement_type = 'return_restock' THEN -ABS\(sm\.cogs_cost\)/);
    expect(bindings).toEqual(['tenant-1', 'invoice-1', 'tenant-1', 'invoice-1', 'tenant-1', 'invoice-1']);
    raw.mockRestore();
  });
});
