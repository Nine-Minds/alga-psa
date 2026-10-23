import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createTenantKnex: vi.fn(),
  getTenantForCurrentRequest: vi.fn(),
  getTenantSettingsByTenantId: vi.fn(),
  insert: vi.fn(),
  merge: vi.fn(),
  now: vi.fn(),
  first: vi.fn(),
}));

vi.mock('@alga-psa/tenancy/server', () => ({
  getTenantForCurrentRequest: mocks.getTenantForCurrentRequest,
}));

vi.mock('@alga-psa/tenancy/actions', () => ({
  getTenantSettingsByTenantId: mocks.getTenantSettingsByTenantId,
}));

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: mocks.createTenantKnex,
  tenantDb: () => ({
    table: () => {
      const builder = {
        select: vi.fn(() => builder),
        first: mocks.first,
        insert: mocks.insert,
        onConflict: vi.fn(() => ({ merge: mocks.merge })),
      };
      mocks.insert.mockReturnValue(builder);
      return builder;
    },
  }),
  withTransaction: async (_knex: unknown, callback: (trx: unknown) => Promise<void>) =>
    callback({ fn: { now: mocks.now } }),
}));

import { updateAnalyticsPreferences } from './analyticsSettings';

describe('analytics settings persistence', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-27T17:45:00.000Z'));
    vi.clearAllMocks();

    const analytics = {
      instance_id: 'instance-1',
      instance_created_at: '2026-01-01T00:00:00.000Z',
      usage_stats_enabled: true,
      first_seen_version: '1.0.0',
      environment: 'test',
    };
    mocks.getTenantForCurrentRequest.mockResolvedValue('tenant-1');
    mocks.getTenantSettingsByTenantId.mockResolvedValue({ settings: { analytics } });
    mocks.first.mockResolvedValue({ settings: { analytics } });
    mocks.createTenantKnex.mockResolvedValue({ knex: {} });
    mocks.merge.mockResolvedValue(undefined);
    mocks.now.mockReturnValue('database-now-expression');
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('binds one application timestamp in both sides of the tenant upsert', async () => {
    await updateAnalyticsPreferences({ usage_stats_enabled: false });

    const expectedTimestamp = '2026-09-27T17:45:00.000Z';
    expect(mocks.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        tenant: 'tenant-1',
        updated_at: expectedTimestamp,
      }),
    );
    expect(mocks.merge).toHaveBeenCalledWith(
      expect.objectContaining({ updated_at: expectedTimestamp }),
    );

    const insertedSettings = JSON.parse(mocks.insert.mock.calls[0][0].settings);
    const mergedSettings = JSON.parse(mocks.merge.mock.calls[0][0].settings);
    expect(insertedSettings.analytics).toMatchObject({
      usage_stats_enabled: false,
      last_updated_at: expectedTimestamp,
    });
    expect(mergedSettings).toEqual(insertedSettings);
    expect(mocks.now).not.toHaveBeenCalled();
  });
});
