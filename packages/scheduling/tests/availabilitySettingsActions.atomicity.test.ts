import { beforeEach, describe, expect, it, vi } from 'vitest';

const createTenantKnexMock = vi.hoisted(() => vi.fn());
const tenantDbMock = vi.hoisted(() => vi.fn());
const hasPermissionMock = vi.hoisted(() => vi.fn());

// Keep the REAL withTransaction so commit/rollback semantics are exercised
// end-to-end instead of being replaced by a pass-through.
vi.mock('@alga-psa/db', async () => {
  const tenant = await vi.importActual<{ withTransaction: unknown }>('@alga-psa/db/lib/tenant');
  return {
    createTenantKnex: createTenantKnexMock,
    tenantDb: tenantDbMock,
    withTransaction: tenant.withTransaction,
  };
});

vi.mock('@alga-psa/auth', () => ({
  withAuth: (action: any) => async (...args: any[]) => action({
    user_id: '00000000-0000-4000-8000-000000000010',
    tenant: '00000000-0000-4000-8000-000000000020',
  }, { tenant: '00000000-0000-4000-8000-000000000020' }, ...args),
  hasPermission: hasPermissionMock,
}));

import {
  createOrUpdateAvailabilitySetting,
  saveUserAvailabilityWeek,
} from '../src/actions/availabilitySettingsActions';
import { buildDefaultUserHours, userHoursToOrderedWeek } from '../src/lib/availabilityUserHours';

const tenant = '00000000-0000-4000-8000-000000000020';
const actorId = '00000000-0000-4000-8000-000000000010';
const managedUserId = '00000000-0000-4000-8000-000000000030';
const outsiderUserId = '00000000-0000-4000-8000-000000000040';

type Row = Record<string, any>;
type Store = Record<string, Row[]>;

const cloneStore = (store: Store): Store =>
  Object.fromEntries(Object.entries(store).map(([tableName, rows]) => [tableName, rows.map((row) => ({ ...row }))]));

/**
 * Minimal knex stand-in with genuine transaction semantics: each
 * knex.transaction() works on a snapshot that only replaces the committed
 * store when the callback resolves; a thrown error discards every staged
 * write, exactly like a rolled-back transaction.
 */
function createFakeDb(seed: Store) {
  const committed = cloneStore(seed);
  const workingByTrx = new WeakMap<object, Store>();
  const options: { failInsert: boolean } = { failInsert: false };

  const buildTable = (store: Store, tableName: string) => {
    const filters: Array<(row: Row) => boolean> = [];
    let sortColumn: string | undefined;
    const rows = () => {
      const matched = (store[tableName] ?? []).filter((row) => filters.every((filter) => filter(row)));
      return sortColumn ? [...matched].sort((a, b) => (a[sortColumn!] > b[sortColumn!] ? 1 : -1)) : matched;
    };
    const builder: any = {
      where(criteria: Row) {
        filters.push((row) => Object.entries(criteria).every(([key, value]) => row[key] === value));
        return builder;
      },
      whereIn(column: string, values: any[]) {
        filters.push((row) => values.includes(row[column]));
        return builder;
      },
      whereNull(column: string) {
        filters.push((row) => row[column] == null);
        return builder;
      },
      select: () => builder,
      forUpdate: () => builder,
      orderBy(column: string) {
        sortColumn = column;
        return builder;
      },
      first: async () => rows()[0],
      del: async () => {
        const doomed = new Set(rows());
        store[tableName] = (store[tableName] ?? []).filter((row) => !doomed.has(row));
        return doomed.size;
      },
      insert: async (values: Row | Row[]) => {
        if (options.failInsert && tableName === 'availability_settings') {
          throw new Error('insert failed');
        }
        store[tableName] = [...(store[tableName] ?? []), ...(Array.isArray(values) ? values : [values])];
      },
      update: async (patch: Row) => {
        const targets = new Set(rows());
        store[tableName] = (store[tableName] ?? []).map((row) => (targets.has(row) ? { ...row, ...patch } : row));
        return targets.size;
      },
      then: (resolve: any, reject: any) => Promise.resolve(rows()).then(resolve, reject),
    };
    return builder;
  };

  const knex = {
    transaction: async (callback: (trx: any) => Promise<any>) => {
      const trx = {};
      workingByTrx.set(trx, cloneStore(committed));
      try {
        const result = await callback(trx);
        const working = workingByTrx.get(trx)!;
        for (const tableName of new Set([...Object.keys(committed), ...Object.keys(working)])) {
          committed[tableName] = working[tableName] ?? [];
        }
        return result;
      } finally {
        workingByTrx.delete(trx);
      }
    },
  };

  return {
    knex,
    options,
    rows: (tableName: string) => committed[tableName] ?? [],
    tenantDbFor: (handle: object) => ({
      table: (tableName: string) => buildTable(workingByTrx.get(handle) ?? committed, tableName),
    }),
  };
}

function wire(db: ReturnType<typeof createFakeDb>) {
  createTenantKnexMock.mockResolvedValue({ knex: db.knex });
  tenantDbMock.mockImplementation((handle: object) => db.tenantDbFor(handle));
}

const savedWeekRows = (userId: string): Row[] =>
  userHoursToOrderedWeek(buildDefaultUserHours()).map((day, index) => ({
    availability_setting_id: `saved-${userId.slice(-2)}-${index}`,
    tenant,
    setting_type: 'user_hours',
    user_id: userId,
    ...day,
    start_time: `${day.start_time}:00`,
    end_time: `${day.end_time}:00`,
  }));

const weekInput = {
  user_id: managedUserId,
  days: userHoursToOrderedWeek(buildDefaultUserHours()).map((day) =>
    day.day_of_week === 3 ? { ...day, end_time: '16:30' } : day
  ),
  buffer_before_minutes: 0,
  buffer_after_minutes: 15,
  config_json: {},
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('saveUserAvailabilityWeek atomicity (real withTransaction)', () => {
  it('rolls back the delete when a later insert fails, keeping the saved week intact', async () => {
    hasPermissionMock.mockResolvedValue(true);
    const db = createFakeDb({
      users: [{ user_id: managedUserId, user_type: 'internal', is_inactive: false }],
      availability_settings: savedWeekRows(managedUserId),
    });
    db.options.failInsert = true;
    wire(db);

    const result = await saveUserAvailabilityWeek(weekInput);

    expect(result).toEqual({ success: false, error: 'Failed to save user hours' });
    const remaining = db.rows('availability_settings');
    expect(remaining).toHaveLength(7);
    expect(remaining.map((row) => row.availability_setting_id).sort()).toEqual(
      savedWeekRows(managedUserId).map((row) => row.availability_setting_id).sort()
    );
    expect(remaining.find((row) => row.day_of_week === 3)?.end_time).toBe('17:00:00');
  });

  it('commits the full replacement week when every write succeeds', async () => {
    hasPermissionMock.mockResolvedValue(true);
    const db = createFakeDb({
      users: [{ user_id: managedUserId, user_type: 'internal', is_inactive: false }],
      availability_settings: savedWeekRows(managedUserId),
    });
    wire(db);

    const result = await saveUserAvailabilityWeek(weekInput);

    expect(result.success).toBe(true);
    expect(result.data).toHaveLength(7);
    expect(result.data?.find((row) => row.day_of_week === 3)?.end_time).toBe('16:30');
    const remaining = db.rows('availability_settings');
    expect(remaining).toHaveLength(7);
    expect(remaining.every((row) => !String(row.availability_setting_id).startsWith('saved-'))).toBe(true);
  });
});

describe('createOrUpdateAvailabilitySetting id-scope authorization', () => {
  const managerScopeSeed: Store = {
    teams: [{ team_id: 'team-1', tenant, manager_id: actorId }],
    team_members: [{ team_id: 'team-1', tenant, user_id: managedUserId }],
    users: [{ user_id: managedUserId, tenant, user_type: 'internal', is_inactive: false, reports_to: null }],
  };

  it.each([
    ['a general-settings row', {
      availability_setting_id: 'general-row',
      tenant,
      setting_type: 'general_settings',
      user_id: null,
      is_available: true,
      advance_booking_days: 30,
    }],
    ["another user's user-hours row", {
      availability_setting_id: 'outsider-row',
      tenant,
      setting_type: 'user_hours',
      user_id: outsiderUserId,
      is_available: true,
      day_of_week: 3,
    }],
  ])('rejects a manager submitting a managed user but targeting %s by id', async (_label, existingRow) => {
    hasPermissionMock.mockResolvedValue(false);
    const db = createFakeDb({
      ...managerScopeSeed,
      availability_settings: [existingRow],
    });
    wire(db);

    const result = await createOrUpdateAvailabilitySetting({
      availability_setting_id: existingRow.availability_setting_id,
      setting_type: 'user_hours',
      user_id: managedUserId,
      day_of_week: 3,
      is_available: false,
    });

    expect(result).toEqual({
      success: false,
      error: 'Insufficient permissions to manage availability settings',
    });
    expect(db.rows('availability_settings')).toEqual([existingRow]);
  });

  it('still allows a manager to update a managed user row and an admin to update any row by id', async () => {
    hasPermissionMock.mockResolvedValue(false);
    const managedRow = {
      availability_setting_id: 'managed-row',
      tenant,
      setting_type: 'user_hours',
      user_id: managedUserId,
      day_of_week: 3,
      is_available: true,
    };
    const db = createFakeDb({
      ...managerScopeSeed,
      availability_settings: [managedRow],
    });
    wire(db);

    const managerResult = await createOrUpdateAvailabilitySetting({
      availability_setting_id: 'managed-row',
      setting_type: 'user_hours',
      user_id: managedUserId,
      day_of_week: 3,
      is_available: false,
    });
    expect(managerResult.success).toBe(true);
    expect(db.rows('availability_settings')[0].is_available).toBe(false);

    hasPermissionMock.mockResolvedValue(true);
    const adminDb = createFakeDb({
      availability_settings: [{ ...managedRow, user_id: outsiderUserId }],
    });
    wire(adminDb);

    const adminResult = await createOrUpdateAvailabilitySetting({
      availability_setting_id: 'managed-row',
      setting_type: 'user_hours',
      user_id: outsiderUserId,
      day_of_week: 3,
      is_available: false,
    });
    expect(adminResult.success).toBe(true);
    expect(adminDb.rows('availability_settings')[0].is_available).toBe(false);
  });
});
