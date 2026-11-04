import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Temporal } from '@js-temporal/polyfill';

/**
 * Time periods bound every user's time sheet, so only roles holding `time_period`
 * may read or change them. Before this gate existed, any signed-in MSP user could
 * create and edit periods from Settings > Time Entry (ticket alga-2026-0002742).
 */

const createTenantKnexMock = vi.hoisted(() => vi.fn());
const tenantDbMock = vi.hoisted(() => vi.fn());
const hasPermissionMock = vi.hoisted(() => vi.fn());
const timePeriodMock = vi.hoisted(() => ({
  getLatest: vi.fn(),
  getAll: vi.fn(),
  findById: vi.fn(),
  findOverlapping: vi.fn(),
  isEditable: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
}));
const timePeriodSettingsMock = vi.hoisted(() => ({
  getActiveSettings: vi.fn(),
}));

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
  getTenantContext: () => authState.currentUser.tenant,
  resolveUserTimeZone: async () => 'UTC',
}));

vi.mock('@alga-psa/auth', () => ({
  withAuth: (action: any) => async (...args: unknown[]) =>
    action(authState.currentUser, { tenant: authState.currentUser.tenant }, ...args),
  getSession: vi.fn(async () => ({ user: { id: authState.currentUser.user_id } })),
  hasPermission: hasPermissionMock,
}));

vi.mock('../src/models/timePeriod', () => ({ TimePeriod: timePeriodMock }));
vi.mock('../src/models/timePeriodSettings', () => ({ TimePeriodSettings: timePeriodSettingsMock }));

const actions = await import('../src/actions/timePeriodsActions');

const PERIOD_INPUT = { start_date: '2026-10-01', end_date: '2026-10-16' };

const noWrites = () => {
  expect(timePeriodMock.create).not.toHaveBeenCalled();
  expect(timePeriodMock.update).not.toHaveBeenCalled();
  expect(timePeriodMock.delete).not.toHaveBeenCalled();
};

describe('time period actions permission gates', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createTenantKnexMock.mockResolvedValue({ knex: {}, tenant: 'tenant-1' });
    timePeriodSettingsMock.getActiveSettings.mockResolvedValue([]);
    timePeriodMock.getLatest.mockResolvedValue(null);
    timePeriodMock.getAll.mockResolvedValue([]);
  });

  it.each([
    ['getLatestTimePeriod', 'read', () => actions.getLatestTimePeriod()],
    ['getTimePeriodSettings', 'read', () => actions.getTimePeriodSettings()],
    ['fetchAllTimePeriods', 'read', () => actions.fetchAllTimePeriods()],
    ['createTimePeriod', 'create', () => actions.createTimePeriod(PERIOD_INPUT)],
    ['generateAndSaveTimePeriods', 'create', () => actions.generateAndSaveTimePeriods('2026-10-01', '2026-12-01')],
    ['updateTimePeriod', 'update', () => actions.updateTimePeriod('period-1', PERIOD_INPUT)],
    ['deleteTimePeriod', 'delete', () => actions.deleteTimePeriod('period-1')],
  ])('%s refuses a user without time_period:%s', async (_name, action, invoke) => {
    hasPermissionMock.mockResolvedValue(false);

    const result = await invoke();

    expect(result).toMatchObject({
      permissionError: expect.any(String),
      messageKey: `msp/time-entry:errors.timePeriod.permissions.${action}`,
    });
    expect(hasPermissionMock).toHaveBeenCalledWith(
      authState.currentUser,
      'time_period',
      action,
      expect.anything()
    );
    noWrites();
  });

  it('lets a permitted user create a period', async () => {
    hasPermissionMock.mockResolvedValue(true);
    timePeriodMock.findOverlapping.mockResolvedValue(null);
    timePeriodMock.create.mockResolvedValue({
      period_id: 'period-1',
      tenant: 'tenant-1',
      start_date: Temporal.PlainDate.from(PERIOD_INPUT.start_date),
      end_date: Temporal.PlainDate.from(PERIOD_INPUT.end_date),
    });

    const result = await actions.createTimePeriod(PERIOD_INPUT);

    expect(result).toMatchObject({ period_id: 'period-1' });
    expect(timePeriodMock.create).toHaveBeenCalledTimes(1);
  });

  it('lets a permitted user read the periods', async () => {
    hasPermissionMock.mockResolvedValue(true);

    await expect(actions.fetchAllTimePeriods()).resolves.toEqual([]);
    await expect(actions.getTimePeriodSettings()).resolves.toEqual([]);
  });

  describe('deleteTimePeriods', () => {
    const managedTeam = (team: unknown) => {
      tenantDbMock.mockReturnValue({
        table: () => ({ where: () => ({ first: async () => team }) }),
      });
    };

    beforeEach(() => {
      timePeriodMock.findById.mockResolvedValue({
        period_id: 'period-1',
        start_date: '2026-01-01',
        end_date: '2026-01-15',
        is_closed: false,
      });
      timePeriodMock.isEditable.mockResolvedValue(true);
      timePeriodMock.delete.mockResolvedValue(undefined);
    });

    it('still works for a team manager without time_period:delete', async () => {
      managedTeam({ team_id: 'team-1' });
      hasPermissionMock.mockResolvedValue(false);

      const result = await actions.deleteTimePeriods(['period-1']);

      expect(result).toEqual({ deletedIds: ['period-1'], failed: [] });
    });

    it('works for a non-manager holding time_period:delete', async () => {
      managedTeam(undefined);
      hasPermissionMock.mockResolvedValue(true);

      const result = await actions.deleteTimePeriods(['period-1']);

      expect(result).toEqual({ deletedIds: ['period-1'], failed: [] });
    });

    it('refuses a non-manager without time_period:delete, per id, without deleting', async () => {
      managedTeam(undefined);
      hasPermissionMock.mockResolvedValue(false);

      const result = await actions.deleteTimePeriods(['period-1', 'period-2']);

      expect(result.deletedIds).toEqual([]);
      expect(result.failed).toEqual([
        { periodId: 'period-1', message: 'Only managers can remove time periods' },
        { periodId: 'period-2', message: 'Only managers can remove time periods' },
      ]);
      noWrites();
    });
  });

  it('reports the viewer capabilities the settings UI gates on', async () => {
    hasPermissionMock.mockImplementation(async (_user: unknown, _resource: string, action: string) => action === 'read');

    await expect(actions.getTimePeriodCapabilities()).resolves.toEqual({
      read: true,
      create: false,
      update: false,
      delete: false,
      manage: false,
    });
  });

  it('leaves the technician time-entry flow ungated', async () => {
    hasPermissionMock.mockResolvedValue(false);
    timePeriodMock.findByDate = vi.fn().mockResolvedValue({
      period_id: 'period-1',
      start_date: '2026-10-01',
      end_date: '2026-10-16',
    });

    await expect(actions.getTimeEntryUserTimeZone()).resolves.toBe('UTC');
    await expect(actions.getCurrentTimePeriod()).resolves.toMatchObject({ period_id: 'period-1' });
  });
});
