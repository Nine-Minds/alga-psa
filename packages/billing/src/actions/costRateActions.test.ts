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
import UserCostRate from '../models/userCostRate';
import {
  listCostRates,
  upsertCostRate,
  deleteCostRate,
  checkCostRateWorkedTimeImpact,
} from './costRateActions';

const callListCostRates = listCostRates as any;
const callUpsertCostRate = upsertCostRate as any;
const callDeleteCostRate = deleteCostRate as any;
const callCheckCostRateWorkedTimeImpact = checkCostRateWorkedTimeImpact as any;

function makeInternalUsersQuery(rows: Array<Record<string, unknown>>) {
  return {
    where: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    orderBy: vi.fn(async () => rows),
  };
}

function makeBillingSettingsQuery(currency: string | null) {
  return {
    select: vi.fn().mockReturnThis(),
    first: vi.fn(async () => (currency ? { default_currency_code: currency } : undefined)),
  };
}

function seedTableMock(users: Array<Record<string, unknown>>, currency: string | null = 'USD') {
  tableMock.mockImplementation((tableName: string) => (
    tableName === 'default_billing_settings'
      ? makeBillingSettingsQuery(currency)
      : makeInternalUsersQuery(users)
  ));
}

describe('cost rate actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    seedTableMock([]);
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

  it('lists only internal users and returns current per-user history in the tenant currency', async () => {
    vi.mocked(hasPermission).mockResolvedValue(true);
    seedTableMock([
      {
        user_id: 'user-1',
        username: 'alice',
        first_name: 'Alice',
        last_name: 'A',
        email: 'alice@example.com',
        is_inactive: false,
      },
    ], 'EUR');

    const result = await callListCostRates({ user_id: 'u1' }, { tenant: 'tenant-1' });

    expect(tableMock).toHaveBeenCalledWith('users');
    const query = tableMock.mock.results[0]?.value;
    expect(query.where).toHaveBeenCalledWith({ user_type: 'internal' });
    expect(result.currency_code).toBe('EUR');
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

  it('returns the worked-time impact indicator for a rate range', async () => {
    vi.mocked(hasPermission).mockResolvedValue(true);
    vi.mocked(UserCostRate.coversWorkedTime).mockResolvedValue(true);

    const result = await callCheckCostRateWorkedTimeImpact(
      { user_id: 'u1' },
      { tenant: 'tenant-1' },
      { user_id: 'user-1', effective_from: '2026-01-01', effective_to: '2026-01-31' }
    );

    expect(UserCostRate.coversWorkedTime).toHaveBeenCalledWith(
      { label: 'knex' },
      'tenant-1',
      'user-1',
      '2026-01-01',
      '2026-01-31'
    );
    expect(result).toEqual({ covers_worked_time: true });
  });
});
