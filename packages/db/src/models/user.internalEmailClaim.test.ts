import { afterAll, describe, expect, it, vi } from 'vitest';
import knexFactory from 'knex';

vi.mock('../lib/tenantId', () => ({ requireTenantId: vi.fn() }));

import User from './user';

const sqlKnex = knexFactory({ client: 'pg' });
afterAll(async () => { await sqlKnex.destroy(); });

/**
 * A knex stand-in that records SQL and answers by table: `.first()` from `answers`, an awaited list
 * query from `lists`. Nothing reaches a database.
 */
function fakeDb(answers: Record<string, unknown>, lists: Record<string, unknown[]> = {}) {
  const executed: Array<{ table: string; sql: string; bindings: unknown[] }> = [];
  const record = (table: string, builder: any) => {
    const { sql, bindings } = builder.toSQL();
    executed.push({ table, sql, bindings: [...bindings] });
  };
  const db: any = vi.fn((table: string) => {
    const name = table.split(' as ')[0];
    const builder: any = sqlKnex(table);
    builder.first = async () => { record(name, builder); return answers[name]; };
    builder.then = (resolve: (rows: unknown[]) => unknown, reject: (error: unknown) => unknown) => {
      record(name, builder);
      return Promise.resolve(lists[name] ?? []).then(resolve, reject);
    };
    return builder;
  });
  db.raw = sqlKnex.raw.bind(sqlKnex);
  return { db, executed };
}

const setup = (overrides: Record<string, unknown> = {}) => ({
  operation_id: 'op-x', customer_tenant: 'cust-1', administrator_invitation_id: null, state: 'failed',
  created_at: new Date('2026-11-01T00:00:00Z'), ...overrides,
});

describe('User.findInternalEmailClaim', () => {
  it('returns an internal user in any tenant, matching on normalized email, without asking about setups', async () => {
    const { db, executed } = fakeDb({ users: { tenant: 't-1', user_id: 'u-1' } });

    const claim = await User.findInternalEmailClaim('  Admin@Oz.TEST ', { db });

    expect(claim).toEqual({ kind: 'user', tenant: 't-1', userId: 'u-1' });
    expect(executed).toHaveLength(1);
    expect(executed[0].bindings).toEqual(expect.arrayContaining(['admin@oz.test', 'internal']));
  });

  it('falls through to a pending co-managed administrator and honours the exclusions', async () => {
    const { db, executed } = fakeDb({}, { co_managed_provisioning_operations: [setup()] });

    const claim = await User.findInternalEmailClaim('a@b.test', { db, excludeUserId: 'me', excludeTenant: 'mine', excludeOperationId: 'op-1' });

    expect(claim).toEqual({ kind: 'pending_administrator', tenant: 'cust-1' });
    expect(executed).toHaveLength(2);
    expect(executed[0].bindings).toContain('me');
    expect(executed[1].bindings).toEqual(expect.arrayContaining(['a@b.test', 'mine', 'op-1']));
  });

  // Citus refuses a join between the setups (distributed on the sponsor) and the invitations (on the
  // customer): the setup scan reads one table, and each invitation lookup is scoped to its own tenant.
  it('reads setups without a join and looks up each invitation in its customer tenant only', async () => {
    const { db, executed } = fakeDb({}, {
      co_managed_provisioning_operations: [setup({ administrator_invitation_id: 'inv-1', state: 'provisioning' })],
      user_invitations: [{ invitation_id: 'inv-1', used_at: null }],
    });

    expect(await User.findInternalEmailClaim('a@b.test', { db })).toEqual({ kind: 'pending_administrator', tenant: 'cust-1' });
    const [setups, invitations] = executed.slice(1);
    expect(setups.sql).not.toMatch(/\bjoin\b/i);
    expect(invitations.table).toBe('user_invitations');
    expect(invitations.sql).not.toMatch(/\bjoin\b/i);
    expect(invitations.bindings).toEqual(expect.arrayContaining(['cust-1', 'inv-1']));
  });

  it('does not claim the email once the setup invitation is used', async () => {
    const { db } = fakeDb({}, {
      co_managed_provisioning_operations: [setup({ administrator_invitation_id: 'inv-1', state: 'provisioning' })],
      user_invitations: [{ invitation_id: 'inv-1', used_at: new Date() }],
    });
    expect(await User.findInternalEmailClaim('a@b.test', { db })).toBeNull();
  });

  it('returns null when nothing claims the email', async () => {
    const { db } = fakeDb({});
    expect(await User.findInternalEmailClaim('free@x.test', { db })).toBeNull();
  });
});
