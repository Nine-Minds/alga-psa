import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  userRow: undefined as { user_type: string | null } | undefined,
  readPortfolio: vi.fn(async () => [] as string[]),
  setPortfolio: vi.fn(async () => [] as string[]),
}));

vi.mock('@alga-psa/auth', () => ({
  withAuth: (fn: any) => (...args: any[]) => fn({ user_id: 'admin' }, { tenant: 't1' }, ...args),
}));
vi.mock('@alga-psa/auth/rbac', () => ({ hasPermission: vi.fn(async () => true) }));
vi.mock('server/src/lib/tier-gating/assertTierAccess', () => ({ assertTierAccess: vi.fn(async () => undefined) }));
vi.mock('@/lib/db', () => ({ createTenantKnex: vi.fn(async () => ({ knex: {} })) }));
vi.mock('@alga-psa/db', () => ({
  tenantDb: () => ({
    table: (name: string) => {
      const query: any = {
        where: () => query,
        whereIn: () => query,
        orderBy: () => query,
        first: async () => (name === 'users' ? m.userRow : undefined),
        select: async () => [],
      };
      return query;
    },
  }),
}));
vi.mock('@alga-psa/authorization/portfolios/service', () => ({
  readUserClientPortfolio: m.readPortfolio,
  setUserClientPortfolio: m.setPortfolio,
}));

import {
  getUserClientPortfolioAction,
  setUserClientPortfolioAction,
} from '../../lib/actions/auth/clientPortfolioActions';

beforeEach(() => {
  m.readPortfolio.mockClear();
  m.setPortfolio.mockClear();
});

describe('client portfolio actions: target user type', () => {
  it.each(['internal', 'service'])('reads and stores a portfolio for an MSP principal (%s)', async (userType) => {
    m.userRow = { user_type: userType };
    await expect((getUserClientPortfolioAction as any)({ userId: 'u1' })).resolves.toEqual([]);
    await expect((setUserClientPortfolioAction as any)({ userId: 'u1', clientIds: [] })).resolves.toEqual([]);
    expect(m.readPortfolio).toHaveBeenCalledOnce();
    expect(m.setPortfolio).toHaveBeenCalledOnce();
  });

  // A raw `!== 'client'` check let any unrecognised type through as if it were an MSP user.
  it.each(['client', 'robot', null])('refuses a user that is not an MSP principal (%s)', async (userType) => {
    m.userRow = { user_type: userType };
    await expect((getUserClientPortfolioAction as any)({ userId: 'u1' })).rejects.toThrow(
      'A client portfolio applies to MSP users only.'
    );
    await expect((setUserClientPortfolioAction as any)({ userId: 'u1', clientIds: ['c1'] })).rejects.toThrow(
      'A client portfolio applies to MSP users only.'
    );
    expect(m.readPortfolio).not.toHaveBeenCalled();
    expect(m.setPortfolio).not.toHaveBeenCalled();
  });
});
