import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Time period settings drive the whole tenant's time-sheet cadence, so reads need
 * `time_period:read` and the CRUD needs `time_period:manage` — the split the v1 API
 * already applies. Without it any signed-in MSP user could rewrite the cadence from
 * Settings > Time Entry (ticket alga-2026-0002742).
 */

const createTenantKnexMock = vi.hoisted(() => vi.fn());
const tenantDbMock = vi.hoisted(() => vi.fn());
const hasPermissionMock = vi.hoisted(() => vi.fn());

const authState = vi.hoisted(() => ({
  currentUser: {
    user_id: 'user-1',
    tenant: 'tenant-1',
  },
}));

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: createTenantKnexMock,
  tenantDb: tenantDbMock,
  withTransaction: async (_db: unknown, fn: (trx: unknown) => Promise<unknown>) => fn({}),
  resolveUserTimeZone: async () => 'UTC',
}));

vi.mock('@alga-psa/auth', () => ({
  withAuth: (action: any) => async (...args: unknown[]) =>
    action(authState.currentUser, { tenant: authState.currentUser.tenant }, ...args),
  hasPermission: hasPermissionMock,
}));

const actions = await import('../src/actions/time-period-settings-actions/timePeriodSettingsActions');

const SETTINGS = {
  time_period_settings_id: 'settings-1',
  tenant: 'tenant-1',
  frequency: 1,
  frequency_unit: 'month' as const,
  is_active: true,
  effective_from: '2026-01-01',
  start_day: 1,
  end_day: 0,
  start_month: 1,
  end_month: 12,
  start_day_of_month: 1,
  end_day_of_month: 0,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

/** Minimal thenable knex stub: rows for reads, a count for deletes. */
function stubTable(options: { rows?: unknown[]; deleted?: number } = {}) {
  const builder: any = {
    where: () => builder,
    whereNot: () => builder,
    andWhere: () => builder,
    orderBy: () => builder,
    delete: async () => options.deleted ?? 0,
    then: (resolve: any, reject: any) => Promise.resolve(options.rows ?? []).then(resolve, reject),
  };
  tenantDbMock.mockReturnValue({ table: () => builder });
  return builder;
}

describe('time period settings actions permission gates', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createTenantKnexMock.mockResolvedValue({ knex: {}, tenant: 'tenant-1' });
  });

  it.each([
    ['getActiveTimePeriodSettings', 'read', () => actions.getActiveTimePeriodSettings()],
    ['createTimePeriodSettings', 'manage', () => actions.createTimePeriodSettings(SETTINGS)],
    ['updateTimePeriodSettings', 'manage', () => actions.updateTimePeriodSettings(SETTINGS as never)],
    ['deleteTimePeriodSettings', 'manage', () => actions.deleteTimePeriodSettings('settings-1')],
  ])('%s refuses a user without time_period:%s', async (_name, action, invoke) => {
    hasPermissionMock.mockResolvedValue(false);

    const result = await invoke();

    expect(result).toMatchObject({
      permissionError: expect.any(String),
      messageKey: `msp/time-entry:errors.timePeriodSettings.permissions.${action}`,
    });
    expect(hasPermissionMock).toHaveBeenCalledWith(
      authState.currentUser,
      'time_period',
      action,
      expect.anything()
    );
    // Nothing touched the table: the gate runs before any query is built.
    expect(tenantDbMock).not.toHaveBeenCalled();
  });

  it('lets a permitted user read the active settings', async () => {
    hasPermissionMock.mockResolvedValue(true);
    stubTable({ rows: [] });

    await expect(actions.getActiveTimePeriodSettings()).resolves.toEqual([]);
    expect(tenantDbMock).toHaveBeenCalled();
  });

  it('lets a permitted user delete a setting', async () => {
    hasPermissionMock.mockResolvedValue(true);
    stubTable({ deleted: 1 });

    await expect(actions.deleteTimePeriodSettings('settings-1')).resolves.toBeUndefined();
  });
});
