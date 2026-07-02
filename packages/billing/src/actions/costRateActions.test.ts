import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@alga-psa/auth', () => ({
  withAuth: (fn: any) => fn,
}));

vi.mock('@alga-psa/auth/rbac', () => ({
  hasPermission: vi.fn(),
}));

const tableMock = vi.fn();

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: vi.fn(async () => ({ knex: { label: 'knex' } })),
  tenantDb: vi.fn(() => ({ table: tableMock })),
  withTransaction: vi.fn(async (_knex: unknown, callback: (trx: any) => Promise<unknown>) => callback({
    raw: vi.fn(),
    fn: { now: () => 'now()' },
  })),
}));

vi.mock('../models/userCostRate', async () => {
  const actual = await vi.importActual<typeof import('../models/userCostRate')>('../models/userCostRate');
  return {
    ...actual,
    default: {
      list: vi.fn(async () => []),
      upsert: vi.fn(async () => ({
        rate_id: 'rate-1',
        user_id: null,
        cost_rate: 5000,
        effective_from: '2026-01-01',
        effective_to: null,
      })),
      getById: vi.fn(async () => ({
        rate_id: 'rate-1',
        user_id: null,
        cost_rate: 5000,
        effective_from: '2026-01-01',
        effective_to: null,
      })),
      delete: vi.fn(async () => ({
        rate_id: 'rate-1',
        user_id: null,
        cost_rate: 5000,
        effective_from: '2026-01-01',
        effective_to: null,
      })),
      coversWorkedTime: vi.fn(async () => false),
    },
  };
});

import { hasPermission } from '@alga-psa/auth/rbac';
import { listCostRates, upsertCostRate, deleteCostRate } from './costRateActions';

const callListCostRates = listCostRates as any;
const callUpsertCostRate = upsertCostRate as any;
const callDeleteCostRate = deleteCostRate as any;

function makeInternalUsersQuery(rows: Array<Record<string, unknown>>) {
  return {
    where: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    orderBy: vi.fn(async () => rows),
  };
}

describe('cost rate actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    tableMock.mockReturnValue(makeInternalUsersQuery([]));
  });

  it('requires billing.read to list cost rates', async () => {
    vi.mocked(hasPermission).mockResolvedValue(false);

    await expect(callListCostRates({ user_id: 'u1' }, { tenant: 'tenant-1' })).rejects.toThrow(
      'Permission denied: billing read required'
    );
  });

  it('requires billing.update to upsert and delete cost rates', async () => {
    vi.mocked(hasPermission).mockResolvedValue(false);

    await expect(callUpsertCostRate(
      { user_id: 'u1' },
      { tenant: 'tenant-1' },
      { user_id: null, cost_rate: 5000, effective_from: '2026-01-01' }
    )).rejects.toThrow('Permission denied: billing update required');

    await expect(callDeleteCostRate({ user_id: 'u1' }, { tenant: 'tenant-1' }, 'rate-1')).rejects.toThrow(
      'Permission denied: billing update required'
    );
  });

  it('lists only internal users and returns current per-user history', async () => {
    vi.mocked(hasPermission).mockResolvedValue(true);
    tableMock.mockReturnValue(makeInternalUsersQuery([
      {
        user_id: 'user-1',
        username: 'alice',
        first_name: 'Alice',
        last_name: 'A',
        email: 'alice@example.com',
        is_inactive: false,
      },
    ]));

    const result = await callListCostRates({ user_id: 'u1' }, { tenant: 'tenant-1' });

    expect(tableMock).toHaveBeenCalledWith('users');
    const query = tableMock.mock.results[0]?.value;
    expect(query.where).toHaveBeenCalledWith({ user_type: 'internal' });
    expect(result.users).toEqual([
      {
        user_id: 'user-1',
        username: 'alice',
        first_name: 'Alice',
        last_name: 'A',
        email: 'alice@example.com',
        is_inactive: false,
        current_rate: null,
        rate_history: [],
      },
    ]);
  });
});
