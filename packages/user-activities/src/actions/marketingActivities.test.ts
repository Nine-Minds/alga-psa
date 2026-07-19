/**
 * T013(a) — marketing activities aggregation gating (executable unit half).
 *
 * fetchMarketingActivities surfaces awaiting-manual-publish social post
 * targets as SCHEDULE activities in the unified feed, but only when the
 * `marketing-module` flag is on for the tenant AND the caller holds
 * marketing:manage; it never throws (returns [] on any failure).
 *
 * Mocking follows opportunityActivities.test.ts: @alga-psa/db is partially
 * mocked at createTenantKnex/tenantDb; @alga-psa/core is partially mocked at
 * isFeatureFlagEnabled; hasPermission comes from the global @alga-psa/auth
 * mock in server/src/test/setup.ts (default true, overridden per test).
 *
 * The DB-backed half (T013(b)) lives in
 * server/src/test/integration/marketingActivities.integration.test.ts.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ActivityPriority, ActivityType } from '@alga-psa/types';
import { hasPermission } from '@alga-psa/auth';

const mocks = vi.hoisted(() => ({
  createTenantKnex: vi.fn(),
  tenantDb: vi.fn(),
  isFeatureFlagEnabled: vi.fn(),
}));

vi.mock('@alga-psa/db', async (importOriginal) => ({
  ...await importOriginal<typeof import('@alga-psa/db')>(),
  createTenantKnex: mocks.createTenantKnex,
  tenantDb: mocks.tenantDb,
}));

vi.mock('@alga-psa/core', async (importOriginal) => ({
  ...await importOriginal<typeof import('@alga-psa/core')>(),
  isFeatureFlagEnabled: mocks.isFeatureFlagEnabled,
}));

import { fetchMarketingActivities } from './activityAggregationActions';

const hasPermissionMock = vi.mocked(hasPermission);

function queryReturning(rows: Record<string, unknown>[]) {
  const query: any = {
    join: vi.fn(),
    where: vi.fn(),
    whereILike: vi.fn(),
    orWhereILike: vi.fn(),
    select: vi.fn(),
    then: (resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) =>
      Promise.resolve(rows).then(resolve, reject),
  };
  query.join.mockReturnValue(query);
  query.where.mockImplementation((value: unknown) => {
    if (typeof value === 'function') value.call(query);
    return query;
  });
  query.whereILike.mockReturnValue(query);
  query.orWhereILike.mockReturnValue(query);
  query.select.mockReturnValue(query);
  return query;
}

const USER = { user_id: 'user-1', tenant: 'tenant-1', user_type: 'internal' };

describe('marketing activity aggregation gating', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isFeatureFlagEnabled.mockResolvedValue(true);
    hasPermissionMock.mockResolvedValue(true);
    mocks.createTenantKnex.mockResolvedValue({ knex: {}, tenant: 'tenant-1' });
  });

  it('returns [] without touching the database when the marketing-module flag is off', async () => {
    mocks.isFeatureFlagEnabled.mockResolvedValue(false);

    const result = await fetchMarketingActivities('user-1', 'tenant-1', {}, USER);

    expect(result).toEqual([]);
    expect(mocks.isFeatureFlagEnabled).toHaveBeenCalledWith('marketing-module', {
      tenantId: 'tenant-1',
      userId: 'user-1',
    });
    expect(mocks.createTenantKnex).not.toHaveBeenCalled();
    expect(mocks.tenantDb).not.toHaveBeenCalled();
  });

  it('returns [] when the caller lacks marketing:manage', async () => {
    hasPermissionMock.mockResolvedValue(false);

    const result = await fetchMarketingActivities('user-1', 'tenant-1', {}, USER);

    expect(result).toEqual([]);
    expect(hasPermissionMock).toHaveBeenCalledWith(USER, 'marketing', 'manage', expect.anything());
    expect(mocks.tenantDb).not.toHaveBeenCalled();
  });

  it('returns [] instead of throwing when the flag backend fails', async () => {
    mocks.isFeatureFlagEnabled.mockRejectedValue(new Error('flag backend down'));
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    const result = await fetchMarketingActivities('user-1', 'tenant-1', {}, USER);

    expect(result).toEqual([]);
    consoleError.mockRestore();
  });

  it('returns [] instead of throwing when the tenant connection fails', async () => {
    mocks.createTenantKnex.mockRejectedValue(new Error('connection refused'));
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    const result = await fetchMarketingActivities('user-1', 'tenant-1', {}, USER);

    expect(result).toEqual([]);
    consoleError.mockRestore();
  });

  it('maps awaiting-manual-publish targets to SCHEDULE activities with overdue escalation', async () => {
    const query = queryReturning([
      {
        target_id: 'target-overdue',
        post_id: 'post-1',
        scheduled_at: '2000-01-01T12:00:00.000Z',
        content_title: 'Launch announcement',
        channel_name: 'LinkedIn',
        created_at: '1999-12-01T12:00:00.000Z',
        updated_at: '1999-12-02T12:00:00.000Z',
      },
      {
        target_id: 'target-upcoming',
        post_id: 'post-2',
        scheduled_at: '2999-01-01T12:00:00.000Z',
        content_title: 'Teaser',
        channel_name: 'Mastodon',
        created_at: '1999-12-01T12:00:00.000Z',
        updated_at: '1999-12-02T12:00:00.000Z',
      },
    ]);
    mocks.tenantDb.mockReturnValue({ table: vi.fn(() => query) });

    const result = await fetchMarketingActivities('user-1', 'tenant-1', {}, USER);

    expect(query.where).toHaveBeenCalledWith({
      't.tenant': 'tenant-1',
      't.status': 'awaiting-manual-publish',
    });
    expect(result).toHaveLength(2);

    expect(result[0]).toEqual(expect.objectContaining({
      id: 'target-overdue',
      title: 'Publish to LinkedIn',
      description: 'Launch announcement',
      type: ActivityType.SCHEDULE,
      status: 'overdue',
      priority: ActivityPriority.HIGH,
      dueDate: '2000-01-01T12:00:00.000Z',
      link: '/msp/marketing/calendar',
      workItemType: 'marketing_post',
    }));

    expect(result[1]).toEqual(expect.objectContaining({
      id: 'target-upcoming',
      title: 'Publish to Mastodon',
      type: ActivityType.SCHEDULE,
      status: 'open',
      priority: ActivityPriority.MEDIUM,
      link: '/msp/marketing/calendar',
    }));
  });
});
