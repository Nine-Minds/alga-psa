import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Success-contract regression for `upsertPlanServiceBucketConfigurationAction`.
 *
 * The action routes the legacy per-(line, service) bucket overlay through the
 * compat layer (single-member 1x pool) and must return the configId on success
 * — the pool identity that now serves that overlay. It used to return
 * undefined after the weighted-burn rewrite, breaking backward compatibility.
 */

const mockHasPermission = vi.fn(async () => true);
const mockUpsertBucketOverlayInTransaction = vi.fn(async () => 'pool-id-123');

const mockCreateTenantKnex = vi.fn(async () => ({ knex: {} }));

const mockWithTransaction = vi.fn(async (_knex: unknown, callback: (trx: any) => Promise<unknown>) => (
  callback({
    fn: { now: () => '2026-08-15T12:00:00.000Z' },
  })
));

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: (...args: unknown[]) => mockCreateTenantKnex(...args),
  withTransaction: (...args: unknown[]) => mockWithTransaction(...args),
  tenantDb: (conn: any, tenant: string) => ({
    table: (table: string) => ({
      where: () => ({
        select: () => ({
          first: vi.fn(async () => null),
        }),
      }),
    }),
    tenantJoin: vi.fn(),
    unscoped: (table: string) => ({ table }),
  }),
}));

vi.mock('@alga-psa/auth', () => ({
  withAuth: (fn: unknown) => fn,
}));

vi.mock('@alga-psa/auth/rbac', () => ({
  hasPermission: (...args: unknown[]) => mockHasPermission(...args),
}));

vi.mock('../src/actions/bucketOverlayActions', () => ({
  upsertBucketOverlayInTransaction: (...args: unknown[]) => mockUpsertBucketOverlayInTransaction(...args),
}));

vi.mock('@alga-psa/ui/lib/errorHandling', () => ({
  actionError: (message: string) => ({ message }),
  permissionError: (message: string) => ({ permissionError: message }),
}));

import { upsertPlanServiceBucketConfigurationAction } from '../src/actions/contractLineServiceConfigurationActions';

const user = { user_id: 'user-1' };

describe('upsertPlanServiceBucketConfigurationAction success contract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUpsertBucketOverlayInTransaction.mockResolvedValue('pool-id-123');
  });

  it('returns { configId } carrying the pool identity on success', async () => {
    const result = await upsertPlanServiceBucketConfigurationAction(
      user,
      { tenant: 'tenant-1' },
      'line-1',
      'service-1',
      { total_minutes: 120, overage_rate: 15000, allow_rollover: false },
    );

    expect(result).toEqual({ configId: 'pool-id-123' });
    expect(mockUpsertBucketOverlayInTransaction).toHaveBeenCalledWith(
      expect.anything(),
      'tenant-1',
      'line-1',
      'service-1',
      {
        total_minutes: 120,
        overage_rate: 15000,
        allow_rollover: false,
        billing_period: 'monthly',
      },
      null,
      null,
    );
  });

  it('still returns an action error when required fields are missing', async () => {
    const result = await upsertPlanServiceBucketConfigurationAction(
      user,
      { tenant: 'tenant-1' },
      'line-1',
      'service-1',
      { allow_rollover: false },
    );

    expect(result).toMatchObject({ message: 'Missing required bucket overlay fields.' });
    expect(mockUpsertBucketOverlayInTransaction).not.toHaveBeenCalled();
  });
});
