import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import knexFactory from 'knex';

const requireTenantIdMock = vi.hoisted(() => vi.fn());

vi.mock('../lib/tenantId', () => ({
  requireTenantId: requireTenantIdMock,
}));

import User from './user';

const sqlKnex = knexFactory({ client: 'pg' });

afterAll(async () => {
  await sqlKnex.destroy();
});

describe('User model Citus-safe recursive query shapes', () => {
  beforeEach(() => {
    requireTenantIdMock.mockReset();
    requireTenantIdMock.mockResolvedValue('tenant-1');
  });

  const createKnexMock = () => {
    const rawMock = vi.fn((sql: string, bindings?: any) => {
      if (/WITH RECURSIVE/i.test(sql)) {
        return Promise.resolve({ rows: [] });
      }

      return sqlKnex.raw(sql, bindings);
    });

    const knexMock = Object.assign(
      vi.fn((table: string) => sqlKnex(table)),
      {
        raw: rawMock,
      }
    ) as any;

    return { knexMock, rawMock };
  };

  it('scopes reports-to chain roots through tenantDb fragments', async () => {
    const { knexMock, rawMock } = createKnexMock();

    await User.isInReportsToChain(knexMock, 'manager-1', 'employee-1');

    const recursiveCall = rawMock.mock.calls.find(([sql]) => /WITH RECURSIVE/i.test(sql));
    expect(recursiveCall?.[0]).toMatch(
      /from "users" as "u"\s+where "u"\."tenant" = \? and "u"\."user_id" = \?/i
    );
    expect(recursiveCall?.[0]).toMatch(
      /from "users" as "u2"\s+inner join "chain" as "c" on "u2"\."user_id" = "c"\."reports_to"\s+where "u2"\."tenant" = \? and "c"\."reports_to" is not null/i
    );
    expect(recursiveCall?.[1]).toEqual(['tenant-1', 'employee-1', 'tenant-1', 'manager-1']);
  });

  it('scopes subordinate traversal roots through tenantDb fragments', async () => {
    const { knexMock, rawMock } = createKnexMock();

    await User.getReportsToSubordinateIds(knexMock, 'manager-1');

    const recursiveCall = rawMock.mock.calls.find(([sql]) => /WITH RECURSIVE/i.test(sql));
    expect(recursiveCall?.[0]).toMatch(
      /from "users" as "u"\s+where "u"\."tenant" = \? and "u"\."reports_to" = \?/i
    );
    expect(recursiveCall?.[0]).toMatch(
      /from "users" as "u2"\s+inner join "reports_to_chain" as "rtc" on "u2"\."reports_to" = "rtc"\."user_id"\s+where "u2"\."tenant" = \? and "rtc"\."depth" < \?/i
    );
    expect(recursiveCall?.[1]).toEqual(['tenant-1', 'manager-1', 'tenant-1', 20]);
  });
});
