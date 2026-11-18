import { afterAll, describe, expect, it, vi } from 'vitest';
import knexFactory from 'knex';

vi.mock('../lib/tenantId', () => ({ requireTenantId: vi.fn() }));

import User from './user';

const sqlKnex = knexFactory({ client: 'pg' });
afterAll(async () => { await sqlKnex.destroy(); });

/** A knex stand-in whose `.first()` records SQL and answers from `answers` by table. */
function fakeDb(answers: Record<string, unknown>) {
  const executed: Array<{ sql: string; bindings: unknown[] }> = [];
  const db: any = vi.fn((table: string) => {
    const builder: any = sqlKnex(table);
    builder.first = async () => {
      const { sql, bindings } = builder.toSQL();
      executed.push({ sql, bindings: [...bindings] });
      return answers[table.split(' as ')[0]];
    };
    return builder;
  });
  db.raw = sqlKnex.raw.bind(sqlKnex);
  return { db, executed };
}

describe('User.findInternalEmailClaim', () => {
  it('returns an internal user in any tenant, matching on normalized email, without asking about setups', async () => {
    const { db, executed } = fakeDb({ users: { tenant: 't-1', user_id: 'u-1' } });

    const claim = await User.findInternalEmailClaim('  Admin@Oz.TEST ', { db });

    expect(claim).toEqual({ kind: 'user', tenant: 't-1', userId: 'u-1' });
    expect(executed).toHaveLength(1);
    expect(executed[0].bindings).toEqual(expect.arrayContaining(['admin@oz.test', 'internal']));
  });

  it('falls through to a pending co-managed administrator and honours the exclusions', async () => {
    const { db, executed } = fakeDb({ co_managed_provisioning_operations: { customer_tenant: 'cust-1' } });

    const claim = await User.findInternalEmailClaim('a@b.test', { db, excludeUserId: 'me', excludeTenant: 'mine', excludeOperationId: 'op-1' });

    expect(claim).toEqual({ kind: 'pending_administrator', tenant: 'cust-1' });
    expect(executed).toHaveLength(2);
    expect(executed[0].bindings).toContain('me');
    expect(executed[1].bindings).toEqual(expect.arrayContaining(['a@b.test', 'mine', 'op-1']));
  });

  it('returns null when nothing claims the email', async () => {
    const { db } = fakeDb({});
    expect(await User.findInternalEmailClaim('free@x.test', { db })).toBeNull();
  });
});
