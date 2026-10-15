/**
 * Compile-only SQL-shape test (no DB): the payments aggregate behind the client
 * AR summary must be joined on `tenant` as well as `invoice_id`. Citus only
 * pushes the join down to a single shard when the distribution key is part of
 * it; without it the statement reaches for a connection on another node
 * mid-transaction, which is what broke the client screen in production
 * (2026-10) once that node ran out of connections.
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

vi.mock('@alga-psa/auth/rbac', () => ({
  hasPermission: async () => true,
}));

vi.mock('@alga-psa/db', async () => {
  const actual = await vi.importActual<typeof import('@alga-psa/db')>('@alga-psa/db');
  return {
    ...actual,
    createTenantKnex: createTenantKnexMock,
    withTransaction: async (db: unknown, callback: (trx: unknown) => Promise<unknown>) => callback(db),
  };
});

vi.mock('@alga-psa/shared/billingClients/billingProfiles', () => ({
  listClientBillingProfiles: async () => [
    { billing_profile_id: 'profile-1', name: 'Default', is_default: true },
  ],
}));

vi.mock('../lib/creditBalance', () => ({
  getAvailableCreditByProfile: async () => new Map<string, number>(),
  getUnattributedCredit: async () => 0,
}));

import { getClientArSummary } from './billingProfileArActions';

describe('getClientArSummary SQL shape', () => {
  it('joins the payments aggregate on the tenant distribution key', async () => {
    const knex = knexFactory({ client: 'pg' });
    const statements: string[] = [];
    (knex.client as any).runner = (builder: any) => ({
      run: async () => {
        statements.push(builder.toSQL().sql);
        return [];
      },
    });
    createTenantKnexMock.mockResolvedValue({ knex });

    await getClientArSummary('22222222-2222-2222-2222-222222222222');

    const invoices = statements.find((sql) => sql.includes('from "invoices" as "i"'));
    expect(invoices).toBeDefined();
    expect(invoices).toContain('"ip"."invoice_id" = "i"."invoice_id"');
    expect(invoices).toContain('"ip"."tenant" = "i"."tenant"');
    // The aggregate can only be joined on the key if it carries it.
    expect(invoices).toContain('group by "tenant", "invoice_id"');
  });
});
