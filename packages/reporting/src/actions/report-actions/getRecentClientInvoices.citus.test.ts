/**
 * Compile-only SQL-shape test (no DB): the completed-payments aggregate must be
 * joined on `tenant` as well as `invoice_id`. Citus can only push the join down
 * to a single shard when the distribution key is part of it — without it the
 * query reaches for a connection on another node mid-transaction, which is how
 * the client screen's invoice lists started failing in production (2026-10).
 */
import { describe, expect, it, vi } from 'vitest';
import knexFactory from 'knex';

const createTenantKnexMock = vi.hoisted(() => vi.fn());

vi.mock('@alga-psa/auth', () => ({
  withAuth: (fn: any) => (...args: unknown[]) =>
    fn(
      { user_id: 'user-1', user_type: 'internal' },
      { tenant: '11111111-1111-1111-1111-111111111111' },
      ...args,
    ),
}));

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: createTenantKnexMock,
  withTransaction: async (db: unknown, callback: (trx: unknown) => Promise<unknown>) => callback(db),
  tenantDb: () => {
    throw new Error('internal callers must not take the portal path');
  },
}));

import { getRecentClientInvoices } from './getRecentClientInvoices';

describe('getRecentClientInvoices SQL shape', () => {
  it('joins the completed-payments aggregate on the tenant distribution key', async () => {
    const knex = knexFactory({ client: 'pg' });
    const statements: string[] = [];
    (knex.client as any).runner = (builder: any) => ({
      run: async () => {
        statements.push(builder.toSQL().sql);
        return [];
      },
    });
    createTenantKnexMock.mockResolvedValue({ knex });
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});

    await getRecentClientInvoices({ clientId: '22222222-2222-2222-2222-222222222222' });

    const invoices = statements.find((sql) => sql.includes('from "invoices" as "i"'));
    expect(invoices).toBeDefined();
    expect(invoices).toContain('"ip"."invoice_id" = "i"."invoice_id"');
    expect(invoices).toContain('"ip"."tenant" = "i"."tenant"');
    // The aggregate can only be joined on the key if it carries it.
    expect(invoices).toContain('group by "tenant", "invoice_id"');

    log.mockRestore();
  });
});
