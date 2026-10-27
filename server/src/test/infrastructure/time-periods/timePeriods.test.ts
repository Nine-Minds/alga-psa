import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import { runWithTenant, tenantDb } from '@alga-psa/db';
import { ITimePeriodSettings, ITimePeriod } from '../../../interfaces/timeEntry.interfaces';
import { createTimePeriod, generateAndSaveTimePeriods, generateTimePeriods } from '@alga-psa/scheduling/actions/timePeriodsActions';
import { createTimePeriodSettings } from '@alga-psa/scheduling/actions/time-period-settings-actions/timePeriodSettingsActions';
import { ensureTimePeriodCoversDate } from '@alga-psa/scheduling/lib/timePeriodMaterialization';
import { createNextTimePeriod as createNextTimePeriodForTenant } from '@alga-psa/scheduling/lib/timePeriodAutomation';
import { Temporal } from '@js-temporal/polyfill';
import { ISO8601String } from '../../../types/types.d';
import * as tenantModule from '../../../lib/tenant';
import { TestContext } from '../../../../test-utils/testContext';
import {
  setupCommonMocks,
  mockNextHeaders,
  mockNextAuth,
  mockRBAC
} from '../../../../test-utils/testMocks';
import {
  createCleanupHook,
  cleanupTables
} from '../../../../test-utils/dbReset';
import {
  expectError
} from '../../../../test-utils/errorUtils';
import {
  createTestDate,
  createTestDateISO,
  freezeTime,
  unfreezeTime,
  dateHelpers
} from '../../../../test-utils/dateUtils';
import { toPlainDate } from 'server/src/lib/utils/dateTimeUtils';

function tenantTable<Row extends object = Record<string, unknown>>(
  context: TestContext,
  tableExpression: string
) {
  return tenantDb(context.db, context.tenantId).table<Row>(tableExpression);
}

// createTimePeriodSettings always writes the semi-monthly columns (defaulting
// them), and every read path validates them as numbers. Fixtures that insert a
// bare row leave NULLs behind and fail that validation, so fill them here.
const withSettingsDefaults = <T extends object>(setting: T) => ({
  start_month: 1,
  start_day_of_month: 1,
  end_month: 12,
  end_day_of_month: 0,
  ...setting,
});

describe('Time Periods Infrastructure', () => {
  const context = new TestContext({
    cleanupTables: ['time_entries', 'time_sheets', 'time_periods', 'time_period_settings'],
    runSeeds: true
  });
  let tenantId: string;

  // The job-facing creator loads the tenant's settings itself; tests seed them in the DB.
  const createNext = async (daysThreshold: number, options: { today?: Temporal.PlainDate } = {}) =>
    (await createNextTimePeriodForTenant(context.db, tenantId, daysThreshold, options)).period;

  // Set up test context with database connection
  beforeAll(async () => {
    await context.initialize();
  });

  afterAll(async () => {
    await context.cleanup();
  });

  beforeEach(async () => {
    // Roll the per-test transaction back and open a fresh one. resetDatabase()
    // used to run here: it destroys the handle it is given and drops the
    // database out from under the context, so every query after the first
    // beforeEach failed with "not queryable".
    await context.reset();

    // Get tenant from context
    tenantId = context.tenantId;

    // Set up mocks. The period actions are gated on `time_period:*` and the fixture
    // user carries no roles, so grant the checks here; refusals have their own suites
    // (packages/scheduling/tests/timePeriod*Actions.permissions.test.ts).
    setupCommonMocks({ tenantId, permissionCheck: () => true });
    vi.spyOn(tenantModule, 'getTenantForCurrentRequest').mockResolvedValue(tenantId);
  });

  afterEach(async () => {
    await createCleanupHook(context.db, [
      'time_entries',
      'time_sheets',
      'time_periods',
      'time_period_settings'
    ])();
    vi.clearAllMocks();
  });

  it('should create a time period based on settings', async () => {
    const setting: ITimePeriodSettings = {
      time_period_settings_id: uuidv4(),
      start_day: 1,
      frequency: 7,
      frequency_unit: 'day',
      is_active: true,
      effective_from: createTestDateISO({ year: 2023, month: 1, day: 1 }),
      effective_to: undefined,
      created_at: createTestDateISO({}),
      updated_at: createTestDateISO({}),
      tenant: tenantId,
      end_day: undefined
    };

    await tenantTable(context, 'time_period_settings').insert(withSettingsDefaults(setting));

    const timePeriodData: Omit<ITimePeriod, 'period_id'> = {
      start_date: '2023-01-01',
      end_date: '2023-01-07',
      tenant: tenantId,
    };

    const result = await createTimePeriod(timePeriodData);

    expect(result.tenant).toBe(tenantId);
    expect(toPlainDate(result.start_date).toString()).toBe('2023-01-01');
    expect(toPlainDate(result.end_date).toString()).toBe('2023-01-07');

    const savedPeriod = await tenantTable(context, 'time_periods').where('period_id', result.period_id).first();
    expect(savedPeriod).toBeDefined();
    expect(toPlainDate(savedPeriod.start_date).toString()).toBe('2023-01-01');
    expect(toPlainDate(savedPeriod.end_date).toString()).toBe('2023-01-07');
  });

  it('should generate and save multiple time periods', async () => {
    const setting: ITimePeriodSettings = {
      time_period_settings_id: uuidv4(),
      start_day: 1,
      frequency: 7,
      frequency_unit: 'day',
      is_active: true,
      effective_from: createTestDateISO({ year: 2023, month: 1, day: 1 }),
      effective_to: undefined,
      created_at: createTestDateISO({}),
      updated_at: createTestDateISO({}),
      tenant: tenantId,
      end_day: 0
    };

    await tenantTable(context, 'time_period_settings').insert(withSettingsDefaults(setting));

    const result = await generateAndSaveTimePeriods(
      '2023-01-01',
      '2023-02-01'
    );

    expect(result).toHaveLength(4);
    expect(result[0].tenant).toBe(tenantId);
    expect(toPlainDate(result[0].start_date).toString()).toBe('2023-01-01');
    expect(toPlainDate(result[0].end_date).toString()).toBe('2023-01-08');
    expect(toPlainDate(result[1].start_date).toString()).toBe('2023-01-08');
    expect(toPlainDate(result[1].end_date).toString()).toBe('2023-01-15');
    expect(toPlainDate(result[2].start_date).toString()).toBe('2023-01-15');
    expect(toPlainDate(result[2].end_date).toString()).toBe('2023-01-22');
  });

  it('should handle multiple non-overlapping settings', async () => {
    const settings: ITimePeriodSettings[] = [
      {
        time_period_settings_id: uuidv4(),
        start_day: 1,
        frequency: 14,
        frequency_unit: 'day',
        is_active: true,
        effective_from: createTestDateISO({ year: 2023, month: 1, day: 1 }),
        effective_to: createTestDateISO({ year: 2023, month: 2, day: 1 }),
        created_at: createTestDateISO({}),
        updated_at: createTestDateISO({}),
        tenant: tenantId,
        end_day: 0
      },
      {
        time_period_settings_id: uuidv4(),
        start_day: 1,
        frequency: 1,
        frequency_unit: 'month',
        is_active: true,
        effective_from: createTestDateISO({ year: 2023, month: 2, day: 1 }),
        effective_to: undefined,
        created_at: createTestDateISO({}),
        updated_at: createTestDateISO({}),
        tenant: tenantId,
        end_day: 0
      },
    ];

    await tenantTable(context, 'time_period_settings').insert(settings.map(withSettingsDefaults));

    const result = await generateAndSaveTimePeriods(
      '2023-01-01',
      '2023-04-01'
    );

    result.sort((a: ITimePeriod, b: ITimePeriod) =>
      toPlainDate(a.start_date).toString() < toPlainDate(b.start_date).toString() ? -1 : 1
    );

    expect(result[0].tenant).toBe(tenantId);
    expect(toPlainDate(result[0].start_date).toString()).toBe('2023-01-01');
    expect(toPlainDate(result[0].end_date).toString()).toBe('2023-01-15');
    expect(toPlainDate(result[1].start_date).toString()).toBe('2023-01-15');
    expect(toPlainDate(result[1].end_date).toString()).toBe('2023-01-29');
    expect(toPlainDate(result[2].start_date).toString()).toBe('2023-02-01');
    expect(toPlainDate(result[2].end_date).toString()).toBe('2023-03-01');
  });

  it('should throw an error when trying to create overlapping time periods', async () => {
    const setting: ITimePeriodSettings = {
      time_period_settings_id: uuidv4(),
      start_day: 1,
      frequency: 7,
      frequency_unit: 'day',
      is_active: true,
      effective_from: createTestDateISO({ year: 2023, month: 1, day: 1 }),
      effective_to: undefined,
      created_at: createTestDateISO({}),
      updated_at: createTestDateISO({}),
      tenant: tenantId,
      end_day: 0
    };

    await tenantTable(context, 'time_period_settings').insert(withSettingsDefaults(setting));

    const timePeriodData1: Omit<ITimePeriod, 'period_id'> = {
      start_date: createTestDateISO({ year: 2026, month: 1, day: 1 }),
      end_date: createTestDateISO({ year: 2026, month: 1, day: 7 }),
      tenant: tenantId,
    };

    const timePeriodData2: Omit<ITimePeriod, 'period_id'> = {
      start_date: createTestDateISO({ year: 2026, month: 1, day: 5 }),
      end_date: createTestDateISO({ year: 2026, month: 1, day: 11 }),
      tenant: tenantId,
    };

    await createTimePeriod(timePeriodData1);
    await expectError(
      () => createTimePeriod(timePeriodData2),
      {
        message: 'Cannot create time period: overlaps with existing period'
      }
    );
  });

  it('should throw an error when trying to generate overlapping time periods', async () => {
    const setting: ITimePeriodSettings = {
      time_period_settings_id: uuidv4(),
      start_day: 1,
      frequency: 7,
      frequency_unit: 'day',
      is_active: true,
      effective_from: createTestDateISO({ year: 2023, month: 1, day: 1 }),
      effective_to: undefined,
      created_at: createTestDateISO({}),
      updated_at: createTestDateISO({}),
      tenant: tenantId,
      end_day: 0
    };

    await tenantTable(context, 'time_period_settings').insert(withSettingsDefaults(setting));

    const existingPeriod: Omit<ITimePeriod, 'period_id'> = {
      start_date: '2023-01-15',
      end_date: '2023-01-21',
      tenant: tenantId,
    };
    await createTimePeriod(existingPeriod);

    await expectError(
      () => generateAndSaveTimePeriods(
        '2023-01-01',
        '2023-02-01'
      )
    );
  });

  it('should generate semi-monthly periods correctly', async () => {
    const settings: ITimePeriodSettings[] = [
      {
        time_period_settings_id: uuidv4(),
        start_day: 1,
        end_day: 15,
        frequency: 1,
        frequency_unit: 'month',
        is_active: true,
        effective_from: createTestDateISO({ year: 2023, month: 1, day: 1 }),
        created_at: createTestDateISO({}),
        updated_at: createTestDateISO({}),
        tenant: tenantId,
      },
      {
        time_period_settings_id: uuidv4(),
        start_day: 16,
        end_day: 0,
        frequency: 1,
        frequency_unit: 'month',
        is_active: true,
        effective_from: createTestDateISO({ year: 2023, month: 1, day: 1 }),
        created_at: createTestDateISO({}),
        updated_at: createTestDateISO({}),
        tenant: tenantId,
      },
    ];

    await tenantTable(context, 'time_period_settings').insert(settings.map(withSettingsDefaults));

    const periods = await generateTimePeriods(
      settings,
      '2023-01-01',
      '2023-05-01'
    );

    periods.sort((a: any, b: any) =>
      toPlainDate(a.start_date).toString() < toPlainDate(b.start_date).toString() ? -1 : 1
    );

    const findPeriodByStartDate = (periods: any[], startDateStr: string) =>
      periods.find(period => toPlainDate(period.start_date).toString() === startDateStr);

    const janFirstPeriod = findPeriodByStartDate(periods, '2023-01-01');
    expect(janFirstPeriod).toBeDefined();
    expect(toPlainDate(janFirstPeriod.start_date).toString()).toBe('2023-01-01');
    expect(toPlainDate(janFirstPeriod.end_date).toString()).toBe('2023-01-16');

    const febFirstPeriod = findPeriodByStartDate(periods, '2023-02-01');
    expect(febFirstPeriod).toBeDefined();
    expect(toPlainDate(febFirstPeriod.start_date).toString()).toBe('2023-02-01');
    expect(toPlainDate(febFirstPeriod.end_date).toString()).toBe('2023-02-16');

    const aprFirstPeriod = findPeriodByStartDate(periods, '2023-04-01');
    expect(aprFirstPeriod).toBeDefined();
    expect(toPlainDate(aprFirstPeriod.start_date).toString()).toBe('2023-04-01');
    expect(toPlainDate(aprFirstPeriod.end_date).toString()).toBe('2023-04-16');
  });

  describe('generateTimePeriods cadence (T0-3)', () => {
    const base = (overrides: Partial<ITimePeriodSettings>): ITimePeriodSettings => ({
      time_period_settings_id: uuidv4(),
      frequency: 1,
      frequency_unit: 'week',
      start_day: 1,
      end_day: 0,
      is_active: true,
      effective_from: createTestDateISO({ year: 2020, month: 1, day: 1 }),
      effective_to: undefined,
      created_at: createTestDateISO({}),
      updated_at: createTestDateISO({}),
      tenant: tenantId,
      ...overrides,
    } as ITimePeriodSettings);
    const pairs = (periods: any[]) =>
      periods
        .map((p) => [toPlainDate(p.start_date).toString(), toPlainDate(p.end_date).toString()])
        .sort((a, b) => (a[0] < b[0] ? -1 : 1));

    it('skips inactive settings', async () => {
      const periods = await generateTimePeriods(
        [base({ is_active: false }), base({ frequency_unit: 'day', frequency: 7, start_day: undefined })],
        '2026-03-02',
        '2026-03-16'
      );
      expect(pairs(periods)).toEqual([
        ['2026-03-02', '2026-03-09'],
        ['2026-03-09', '2026-03-16'],
      ]);
      expect(await generateTimePeriods([base({ is_active: false })], '2026-03-02', '2026-03-30')).toEqual([]);
    });

    it('includes a period whose exclusive end equals the range end', async () => {
      const periods = await generateTimePeriods([base({})], '2026-03-02', '2026-03-16');
      expect(pairs(periods)).toEqual([
        ['2026-03-02', '2026-03-09'],
        ['2026-03-09', '2026-03-16'],
      ]);
    });

    it('includes a period ending exactly at effective_to', async () => {
      const periods = await generateTimePeriods(
        [base({ effective_to: createTestDateISO({ year: 2026, month: 3, day: 16 }) })],
        '2026-03-02',
        '2026-04-30'
      );
      expect(pairs(periods)).toEqual([
        ['2026-03-02', '2026-03-09'],
        ['2026-03-09', '2026-03-16'],
      ]);
    });

    it('aligns a yearly profile to its configured start month', async () => {
      const periods = await generateTimePeriods(
        [base({ frequency_unit: 'year', start_day: undefined, start_month: 7, start_day_of_month: 1, end_month: 6, end_day_of_month: 0 })],
        '2023-01-01',
        '2025-07-01'
      );
      expect(pairs(periods)).toEqual([
        ['2023-07-01', '2024-07-01'],
        ['2024-07-01', '2025-07-01'],
      ]);
    });

    it('ends a seasonal yearly profile at end_month and restarts on start_month', async () => {
      const periods = await generateTimePeriods(
        [base({ frequency_unit: 'year', start_day: undefined, start_month: 7, start_day_of_month: 1, end_month: 12, end_day_of_month: 0 })],
        '2023-01-01',
        '2025-01-01'
      );
      expect(pairs(periods)).toEqual([
        ['2023-07-01', '2024-01-01'],
        ['2024-07-01', '2025-01-01'],
      ]);
    });

    it('reads a monthly end_day as the last included day, so 1-15 / 16-end tile', async () => {
      const periods = await generateTimePeriods(
        [
          base({ frequency_unit: 'month', start_day: 1, end_day: 15 }),
          base({ frequency_unit: 'month', start_day: 16, end_day: 0 }),
        ],
        '2026-01-01',
        '2026-04-01'
      );
      expect(pairs(periods)).toEqual([
        ['2026-01-01', '2026-01-16'],
        ['2026-01-16', '2026-02-01'],
        ['2026-02-01', '2026-02-16'],
        ['2026-02-16', '2026-03-01'],
        ['2026-03-01', '2026-03-16'],
        ['2026-03-16', '2026-04-01'],
      ]);
    });
  });

  describe('createNextTimePeriod', () => {
    beforeEach(async () => {
      freezeTime({ year: 2024, month: 1, day: 15 });
    });

    afterEach(() => {
      unfreezeTime();
    });

    it('should create next period when within threshold days', async () => {
      const settings: ITimePeriodSettings[] = [{
        time_period_settings_id: uuidv4(),
        start_day: 1,
        frequency: 7,
        frequency_unit: 'day',
        is_active: true,
        effective_from: createTestDateISO({ year: 2024, month: 1, day: 1 }),
        effective_to: undefined,
        created_at: createTestDateISO({}),
        updated_at: createTestDateISO({}),
        tenant: tenantId,
        end_day: undefined
      }];

      const initialPeriod: Omit<ITimePeriod, 'period_id'> = {
        start_date: '2024-01-15',
        end_date: '2024-01-22',
        tenant: tenantId,
      };
      await createTimePeriod(initialPeriod);
      await tenantTable(context, 'time_period_settings').insert(settings.map(withSettingsDefaults));

      // createNextTimePeriod is a plain function, not a withAuth action: it loads the
      // tenant's own active settings and takes no settings from the caller.
      const result = await createNext(7);

      expect(result).not.toBeNull();
      expect(result!.tenant).toBe(tenantId);
      expect(toPlainDate(result!.start_date).toString()).toBe('2024-01-22');
      expect(toPlainDate(result!.end_date).toString()).toBe('2024-01-29');
    });

    it('should not create next period when outside threshold days', async () => {
      const settings: ITimePeriodSettings[] = [{
        time_period_settings_id: uuidv4(),
        start_day: 1,
        frequency: 7,
        frequency_unit: 'day',
        is_active: true,
        effective_from: createTestDateISO({ year: 2024, month: 1, day: 1 }),
        effective_to: undefined,
        created_at: createTestDateISO({}),
        updated_at: createTestDateISO({}),
        tenant: tenantId,
        end_day: undefined
      }];

      const initialPeriod: Omit<ITimePeriod, 'period_id'> = {
        start_date: '2024-01-15',
        end_date: '2024-02-15',
        tenant: tenantId,
      };
      await createTimePeriod(initialPeriod);
      await tenantTable(context, 'time_period_settings').insert(settings.map(withSettingsDefaults));

      const result = await createNext(5);

      expect(result).toBeNull();
    });
  });

  describe('first period on any day (#3206)', () => {
    const sundayWeekly = (effectiveFrom: string): ITimePeriodSettings => ({
      time_period_settings_id: uuidv4(),
      start_day: 7,
      end_day: 0,
      frequency: 1,
      frequency_unit: 'week',
      is_active: true,
      effective_from: effectiveFrom,
      effective_to: undefined,
      created_at: createTestDateISO({}),
      updated_at: createTestDateISO({}),
      tenant: tenantId,
    });

    const insertSetting = async (setting: ITimePeriodSettings) => {
      await tenantTable(context, 'time_period_settings').insert(withSettingsDefaults(setting));
    };

    const storedPeriods = async () => {
      const rows = await tenantTable(context, 'time_periods').orderBy('start_date', 'asc');
      return rows.map((r: any) => [toPlainDate(r.start_date).toString(), toPlainDate(r.end_date).toString()]);
    };

    afterEach(() => {
      unfreezeTime();
    });

    it('15. createNextTimePeriod bootstraps on a non-start day', async () => {
      freezeTime({ year: 2024, month: 1, day: 17 }); // Wednesday
      const setting = sundayWeekly(createTestDateISO({ year: 2023, month: 1, day: 1 }));
      await insertSetting(setting);

      const result = await createNext(5);

      expect(result).not.toBeNull();
      // [01-14, 01-21) is the current week; 01-21 is within 5 days, so 01-21..01-28 follows.
      expect(await storedPeriods()).toEqual([
        ['2024-01-14', '2024-01-21'],
        ['2024-01-21', '2024-01-28'],
      ]);
    });

    it('16. bootstrap honours the threshold for a future effective_from', async () => {
      const today = Temporal.PlainDate.from('2024-01-17');
      const far = sundayWeekly('2024-02-04T00:00:00.000Z'); // 18 days out
      await insertSetting(far);
      expect(await createNext(5, { today })).toBeNull();
      expect(await storedPeriods()).toEqual([]);

      const near = { ...far, effective_from: '2024-01-21T00:00:00.000Z' }; // 4 days out
      await tenantTable(context, 'time_period_settings')
        .where({ time_period_settings_id: far.time_period_settings_id })
        .update({ effective_from: near.effective_from });
      const result = await createNext(5, { today });
      expect(result).not.toBeNull();
      expect((await storedPeriods())[0]).toEqual(['2024-01-21', '2024-01-28']);
    });

    it('17. ensureTimePeriodCoversDate creates the current period once and no-ops without settings', async () => {
      const date = Temporal.PlainDate.from('2024-01-17');

      await ensureTimePeriodCoversDate(context.db, tenantId, date);
      expect(await storedPeriods()).toEqual([]); // no settings

      await insertSetting(sundayWeekly(createTestDateISO({ year: 2023, month: 1, day: 1 })));
      await ensureTimePeriodCoversDate(context.db, tenantId, date);
      expect(await storedPeriods()).toEqual([['2024-01-14', '2024-01-21']]);

      await ensureTimePeriodCoversDate(context.db, tenantId, date);
      expect(await storedPeriods()).toEqual([['2024-01-14', '2024-01-21']]);
    });

    it('18. ensureTimePeriodCoversDate fills a two-week gap through the containing period', async () => {
      await insertSetting(sundayWeekly(createTestDateISO({ year: 2023, month: 1, day: 1 })));
      await tenantTable(context, 'time_periods').insert({
        period_id: uuidv4(),
        tenant: tenantId,
        start_date: '2023-12-24',
        end_date: '2023-12-31',
      });

      await ensureTimePeriodCoversDate(context.db, tenantId, Temporal.PlainDate.from('2024-01-17'));

      expect(await storedPeriods()).toEqual([
        ['2023-12-24', '2023-12-31'],
        ['2023-12-31', '2024-01-07'],
        ['2024-01-07', '2024-01-14'],
        ['2024-01-14', '2024-01-21'],
      ]);
    });

    describe('effective_from default (createTimePeriodSettings)', () => {
      const weeklyInput = { frequency: 1, frequency_unit: 'week' as const, start_day: 7, end_day: 0 };

      const useUserTimeZone = async (timezone: string) => {
        await tenantTable(context, 'users').where({ user_id: context.userId }).update({ timezone });
        setupCommonMocks({ tenantId, userId: context.userId, user: context.user, permissionCheck: () => true });
      };

      it('19. (a) mid-week save with no effective_from starts at the current week start', async () => {
        await useUserTimeZone('UTC');
        freezeTime('2026-10-10T15:00:00.000Z'); // Saturday

        const created: any = await createTimePeriodSettings(weeklyInput);
        expect(String(created.effective_from).slice(0, 10)).toBe('2026-10-04');

        const today = Temporal.PlainDate.from('2026-10-10');
        await createNext(0, { today });
        expect(await storedPeriods()).toEqual([['2026-10-04', '2026-10-11']]);
      });

      it('20. (b) late-evening save in America/New_York still covers the local today', async () => {
        await useUserTimeZone('America/New_York');
        freezeTime('2026-10-11T02:30:00.000Z'); // Sat 22:30 in New York; UTC date is already 10/11

        const created: any = await createTimePeriodSettings(weeklyInput);
        expect(String(created.effective_from).slice(0, 10)).toBe('2026-10-04'); // a UTC-based default would be 2026-10-11

        const localToday = Temporal.PlainDate.from('2026-10-10');
        await ensureTimePeriodCoversDate(context.db, tenantId, localToday);
        expect(await storedPeriods()).toEqual([['2026-10-04', '2026-10-11']]);
      });

      it('21. (c) explicit past effective_from is honored unchanged', async () => {
        await useUserTimeZone('America/New_York');
        freezeTime('2026-10-11T02:30:00.000Z');

        const created: any = await createTimePeriodSettings({ ...weeklyInput, effective_from: '2026-09-01' });
        expect(String(created.effective_from).slice(0, 10)).toBe('2026-09-01');

        await ensureTimePeriodCoversDate(context.db, tenantId, Temporal.PlainDate.from('2026-10-10'));
        const periods = await storedPeriods();
        expect(periods[periods.length - 1]).toEqual(['2026-10-04', '2026-10-11']);
      });

      it('22. (c) explicit future effective_from starts there and creates nothing for today', async () => {
        await useUserTimeZone('America/New_York');
        freezeTime('2026-10-11T02:30:00.000Z');

        const created: any = await createTimePeriodSettings({ ...weeklyInput, effective_from: '2026-10-18' });
        expect(String(created.effective_from).slice(0, 10)).toBe('2026-10-18');

        const today = Temporal.PlainDate.from('2026-10-10');
        await ensureTimePeriodCoversDate(context.db, tenantId, today);
        expect(await storedPeriods()).toEqual([]);

        await createNext(14, { today });
        expect((await storedPeriods())[0]).toEqual(['2026-10-18', '2026-10-25']);
      });

      it('23. back-dated default overlapping a setting that ended earlier this week is rejected', async () => {
        await useUserTimeZone('UTC');
        freezeTime('2026-10-10T15:00:00.000Z');
        // Existing weekly setting ended 10/06 (mid-week). Old default (10/10) would not overlap;
        // the aligned default (10/04) does, and weekly overlap semantics are date-range based.
        const existing = { ...sundayWeekly('2026-09-01T00:00:00.000Z'), effective_to: '2026-10-06T00:00:00.000Z' };
        await insertSetting(existing);

        const result: any = await createTimePeriodSettings(weeklyInput);
        expect(result.effective_from).toBeUndefined();
        expect(result.actionError).toMatch(/overlaps/i);

        const explicit: any = await createTimePeriodSettings({ ...weeklyInput, effective_from: '2026-10-10' });
        expect(String(explicit.effective_from).slice(0, 10)).toBe('2026-10-10');
      });
    });
  });
});
