import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import { ITimePeriodSettings, ITimePeriod } from '../../interfaces/timeEntry.interfaces';
import { createTimePeriod, generateAndSaveTimePeriods, generateTimePeriods, createNextTimePeriod } from '../../lib/actions/timePeriodsActions';
import { TimePeriodSettings } from '../../lib/models/timePeriodSettings';
import { ISO8601String } from '../../types/types.d';
import * as tenantModule from '../../lib/tenant';
import { TestContext } from '../../../../test-utils/testContext';
import {
  setupCommonMocks,
  mockNextHeaders,
  mockNextAuth,
  mockRBAC
} from '../../../../test-utils/testMocks';
import {
  resetDatabase,
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

describe('Time Periods Infrastructure', () => {
  const context = new TestContext({
    cleanupTables: ['time_entries', 'time_sheets', 'time_periods', 'time_period_settings'],
    runSeeds: true
  });
  let tenantId: string;

  // Set up test context with database connection
  beforeAll(async () => {
    await context.initialize();
  });

  afterAll(async () => {
    await context.cleanup();
  });

  beforeEach(async () => {
    // Reset database state
    await resetDatabase(context.db);

    // Get tenant from context
    tenantId = context.tenantId;

    // Set up mocks
    setupCommonMocks({ tenantId });
    vi.spyOn(tenantModule, 'getTenantForCurrentRequest').mockResolvedValue(tenantId);
  });

  // Use cleanup hook for test isolation
  const cleanup = createCleanupHook(context.db, [
    'time_entries',
    'time_sheets',
    'time_periods',
    'time_period_settings'
  ]);
  afterEach(async () => {
    cleanup();
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

    await context.db('time_period_settings').insert(setting);

    const timePeriodData: Omit<ITimePeriod, 'period_id'> = {
      start_date: createTestDateISO({ year: 2023, month: 1, day: 1 }),
      end_date: createTestDateISO({ year: 2023, month: 1, day: 7 }),
      tenant: tenantId,
    };

    const result = await createTimePeriod(timePeriodData);

    expect(result).toMatchObject({
      start_date: '2023-01-01T00:00:00Z',
      end_date: '2023-01-07T00:00:00Z',
      tenant: tenantId,
    });

    const savedPeriod = await context.db('time_periods').where('period_id', result.period_id).first();
    expect(savedPeriod).toBeDefined();
    expect(savedPeriod.start_date).toEqual(createTestDate({ year: 2023, month: 1, day: 1 }));
    expect(savedPeriod.end_date).toEqual(createTestDate({ year: 2023, month: 1, day: 7 }));
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

    await context.db('time_period_settings').insert(setting);

    const result = await generateAndSaveTimePeriods(
      createTestDateISO({ year: 2023, month: 1, day: 1 }),
      createTestDateISO({ year: 2023, month: 2, day: 1 })
    );

    expect(result).toHaveLength(4);
    expect(result[0]).toMatchObject({
      start_date: '2023-01-01T00:00:00Z',
      end_date: '2023-01-08T00:00:00Z',
      tenant: tenantId,
    });
    expect(result[1]).toMatchObject({
      start_date: '2023-01-08T00:00:00Z',
      end_date: '2023-01-15T00:00:00Z',
      tenant: tenantId,
    });
    expect(result[2]).toMatchObject({
      start_date: '2023-01-15T00:00:00Z',
      end_date: '2023-01-22T00:00:00Z',
      tenant: tenantId,
    });
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

    await context.db('time_period_settings').insert(settings);

    const result = await generateAndSaveTimePeriods(
      createTestDateISO({ year: 2023, month: 1, day: 1 }),
      createTestDateISO({ year: 2023, month: 4, day: 1 })
    );

    result.sort((a: ITimePeriod, b: ITimePeriod) => a.start_date < b.start_date ? -1 : 1);

    expect(result[0]).toMatchObject({
      start_date: '2023-01-01T00:00:00Z',
      end_date: '2023-01-15T00:00:00Z',
      tenant: tenantId,
    });
    expect(result[1]).toMatchObject({
      start_date: '2023-01-15T00:00:00Z',
      end_date: '2023-01-29T00:00:00Z',
      tenant: tenantId,
    });
    expect(result[2]).toMatchObject({
      start_date: '2023-02-01T00:00:00Z',
      end_date: '2023-03-01T00:00:00Z',
      tenant: tenantId,
    });
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

    await context.db('time_period_settings').insert(setting);

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

    await context.db('time_period_settings').insert(setting);

    const existingPeriod: Omit<ITimePeriod, 'period_id'> = {
      start_date: createTestDateISO({ year: 2023, month: 1, day: 15 }),
      end_date: createTestDateISO({ year: 2023, month: 1, day: 21 }),
      tenant: tenantId,
    };
    await createTimePeriod(existingPeriod);

    await expectError(
      () => generateAndSaveTimePeriods(
        createTestDateISO({ year: 2023, month: 1, day: 1 }),
        createTestDateISO({ year: 2023, month: 2, day: 1 })
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
        start_day: 15,
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

    await context.db('time_period_settings').insert(settings);

    const periods = await generateTimePeriods(
      settings,
      createTestDateISO({ year: 2023, month: 1, day: 1 }),
      createTestDateISO({ year: 2023, month: 5, day: 1 })
    );

    periods.sort((a: ITimePeriod, b: ITimePeriod) => a.start_date < b.start_date ? -1 : 1);

    const findPeriodByStartDate = (periods: ITimePeriod[], startDateStr: string) => 
      periods.find(period => period.start_date === startDateStr);

    const janFirstPeriod = findPeriodByStartDate(periods, '2023-01-01T00:00:00Z');
    expect(janFirstPeriod).toMatchObject({
      start_date: '2023-01-01T00:00:00Z',
      end_date: '2023-01-15T00:00:00Z',
    });

    const febFirstPeriod = findPeriodByStartDate(periods, '2023-02-01T00:00:00Z');
    expect(febFirstPeriod).toMatchObject({
      start_date: '2023-02-01T00:00:00Z',
      end_date: '2023-02-15T00:00:00Z',
    });

    const aprFirstPeriod = findPeriodByStartDate(periods, '2023-04-01T00:00:00Z');
    expect(aprFirstPeriod).toMatchObject({
      start_date: '2023-04-01T00:00:00Z',
      end_date: '2023-04-15T00:00:00Z',
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
        start_date: createTestDateISO({ year: 2024, month: 1, day: 15 }),
        end_date: createTestDateISO({ year: 2024, month: 1, day: 22 }),
        tenant: tenantId,
      };
      await createTimePeriod(initialPeriod);

      const result = await createNextTimePeriod(context.db, settings, 7);

      expect(result).not.toBeNull();
      expect(result).toMatchObject({
        start_date: '2024-01-22T00:00:00Z',
        end_date: '2024-01-29T00:00:00Z',
        tenant: tenantId,
      });
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
        start_date: createTestDateISO({ year: 2024, month: 1, day: 15 }),
        end_date: createTestDateISO({ year: 2024, month: 2, day: 15 }),
        tenant: tenantId,
      };
      await createTimePeriod(initialPeriod);

      const result = await createNextTimePeriod(context.db, settings, 5);

      expect(result).toBeNull();
    });
  });
});
