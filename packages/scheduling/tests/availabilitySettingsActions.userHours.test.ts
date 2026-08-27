import { beforeEach, describe, expect, it, vi } from 'vitest';

const createTenantKnexMock = vi.hoisted(() => vi.fn());
const tenantDbMock = vi.hoisted(() => vi.fn());
const withTransactionMock = vi.hoisted(() => vi.fn());
const hasPermissionMock = vi.hoisted(() => vi.fn());

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: createTenantKnexMock,
  tenantDb: tenantDbMock,
  withTransaction: withTransactionMock,
}));

vi.mock('@alga-psa/auth', () => ({
  withAuth: (action: any) => async (...args: any[]) => action({
    user_id: '00000000-0000-4000-8000-000000000010',
    tenant: '00000000-0000-4000-8000-000000000020',
  }, { tenant: '00000000-0000-4000-8000-000000000020' }, ...args),
  hasPermission: hasPermissionMock,
}));

import { saveUserAvailabilityWeek } from '../src/actions/availabilitySettingsActions';
import { buildDefaultUserHours, userHoursToOrderedWeek } from '../src/lib/availabilityUserHours';

const targetUserId = '00000000-0000-4000-8000-000000000030';
const input = {
  user_id: targetUserId,
  days: userHoursToOrderedWeek(buildDefaultUserHours()),
  buffer_before_minutes: 0,
  buffer_after_minutes: 15,
  config_json: {},
};

function query(options: { rows?: any[]; first?: any; failInsert?: boolean } = {}) {
  const value: any = {};
  for (const method of ['where', 'whereIn', 'select', 'orderBy', 'forUpdate']) value[method] = vi.fn(() => value);
  value.first = vi.fn().mockResolvedValue(options.first);
  value.del = vi.fn().mockResolvedValue(1);
  value.insert = options.failInsert ? vi.fn().mockRejectedValue(new Error('write failed')) : vi.fn().mockResolvedValue(7);
  value.then = (resolve: any, reject: any) => Promise.resolve(options.rows ?? []).then(resolve, reject);
  return value;
}

describe('saveUserAvailabilityWeek', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createTenantKnexMock.mockResolvedValue({ knex: { name: 'db' } });
    withTransactionMock.mockImplementation(async (_db, callback) => callback({ name: 'trx' }));
  });

  it('locks the user and replaces all seven rows in one transaction', async () => {
    hasPermissionMock.mockResolvedValue(true);
    const userQuery = query({ first: { user_id: targetUserId } });
    const deleteQuery = query();
    const insertQuery = query();
    const rows = input.days.map((day, index) => ({
      availability_setting_id: `row-${index}`,
      tenant: '00000000-0000-4000-8000-000000000020',
      setting_type: 'user_hours',
      user_id: targetUserId,
      ...day,
      start_time: `${day.start_time}:00`,
      end_time: `${day.end_time}:00`,
    }));
    const readQuery = query({ rows });
    const availabilityQueries = [deleteQuery, insertQuery, readQuery];
    tenantDbMock.mockReturnValue({
      table: vi.fn((tableName: string) => tableName === 'users' ? userQuery : availabilityQueries.shift()),
    });

    const result = await saveUserAvailabilityWeek(input);

    expect(result.success).toBe(true);
    expect(result.data).toHaveLength(7);
    expect(result.data?.[3].end_time).toBe('17:00');
    expect(withTransactionMock).toHaveBeenCalledTimes(1);
    expect(userQuery.forUpdate).toHaveBeenCalledTimes(1);
    expect(deleteQuery.del).toHaveBeenCalledTimes(1);
    expect(insertQuery.insert).toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({ day_of_week: 3, user_id: targetUserId }),
    ]));
  });

  it('returns failure without claiming success when the transactional write fails', async () => {
    hasPermissionMock.mockResolvedValue(true);
    const userQuery = query({ first: { user_id: targetUserId } });
    const availabilityQueries = [query(), query({ failInsert: true })];
    tenantDbMock.mockReturnValue({
      table: vi.fn((tableName: string) => tableName === 'users' ? userQuery : availabilityQueries.shift()),
    });

    const result = await saveUserAvailabilityWeek(input);

    expect(result).toEqual({ success: false, error: 'Failed to save user hours' });
    expect(withTransactionMock).toHaveBeenCalledTimes(1);
  });

  it('rejects a user outside a manager scope before opening a transaction', async () => {
    hasPermissionMock.mockResolvedValue(false);
    const teamsQuery = query({ rows: [] });
    const reportsQuery = query({ rows: [] });
    tenantDbMock.mockReturnValue({
      table: vi.fn((tableName: string) => tableName === 'teams' ? teamsQuery : reportsQuery),
    });

    const result = await saveUserAvailabilityWeek(input);

    expect(result).toEqual({
      success: false,
      error: 'Insufficient permissions to manage availability for this user',
    });
    expect(withTransactionMock).not.toHaveBeenCalled();
  });

  it('allows an actual managed-team member without tenant-wide settings permission', async () => {
    hasPermissionMock.mockResolvedValue(false);
    const scopeDb = {
      table: vi.fn((tableName: string) => {
        if (tableName === 'teams') return query({ rows: [{ team_id: 'team-1' }] });
        if (tableName === 'team_members') return query({ rows: [{ user_id: targetUserId }] });
        return query({ rows: [] });
      }),
    };
    const userQuery = query({ first: { user_id: targetUserId } });
    const savedRows = input.days.map((day, index) => ({
      availability_setting_id: `row-${index}`,
      tenant: '00000000-0000-4000-8000-000000000020',
      setting_type: 'user_hours',
      user_id: targetUserId,
      ...day,
    }));
    const availabilityQueries = [query(), query(), query({ rows: savedRows })];
    const trxDb = {
      table: vi.fn((tableName: string) => tableName === 'users' ? userQuery : availabilityQueries.shift()),
    };
    tenantDbMock.mockImplementation((db) => db.name === 'trx' ? trxDb : scopeDb);

    const result = await saveUserAvailabilityWeek(input);

    expect(result.success).toBe(true);
    expect(withTransactionMock).toHaveBeenCalledTimes(1);
  });
});
