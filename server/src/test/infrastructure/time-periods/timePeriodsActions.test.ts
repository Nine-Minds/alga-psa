import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import { generateAndSaveTimePeriods, fetchAllTimePeriods } from 'server/src/lib/actions/timePeriodsActions';
import { TimePeriodSettings } from 'server/src/lib/models/timePeriodSettings';
import { TimePeriod } from 'server/src/lib/models/timePeriod';
import { ITimePeriodSettings } from 'server/src/interfaces/timeEntry.interfaces';
import { ISO8601String } from 'server/src/types/types.d';
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
  createTestDate,
  createTestDateISO,
  freezeTime,
  unfreezeTime,
  dateHelpers
} from '../../../../test-utils/dateUtils';

describe('Time Periods Actions', () => {
  const context = new TestContext({
    cleanupTables: ['time_periods', 'time_period_settings'],
    runSeeds: true
  });
  let timePeriodSettingsId: string;

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

    // Set up mocks
    setupCommonMocks({ tenantId: context.tenantId });

    // Create time period settings
    timePeriodSettingsId = uuidv4();
    const settings: ITimePeriodSettings = {
      time_period_settings_id: timePeriodSettingsId,
      tenant: context.tenantId,
      frequency: 1,
      frequency_unit: 'month',
      start_day: 1,
      end_day: 0,
      is_active: true,
      effective_from: createTestDateISO({ year: 2024, month: 1, day: 1 }),
      created_at: createTestDateISO({ year: 2024, month: 1, day: 1 }),
      updated_at: createTestDateISO({ year: 2024, month: 1, day: 1 })
    };

    await context.db('time_period_settings').insert(settings);
  });

  // Use cleanup hook for test isolation
  const cleanup = createCleanupHook(context.db, [
    'time_periods',
    'time_period_settings'
  ]);
  afterEach(cleanup);

  it('should generate and save time periods based on settings', async () => {
    // Arrange
    const startDate = createTestDateISO({ year: 2026, month: 1, day: 1 });
    const endDate = createTestDateISO({ year: 2027, month: 3, day: 1 });
    const expectedEndDateToExist = createTestDateISO({ year: 2026, month: 3, day: 1 });

    // Act
    const result = await generateAndSaveTimePeriods(startDate, endDate);
    const periods = await fetchAllTimePeriods();

    // Assert
    expect(result).toBeDefined();
    expect(result.length).toBeGreaterThan(0);

    // Verify the periods were saved to the database
    const savedPeriods = await context.db('time_periods')
      .where('tenant', context.tenantId)
      .orderBy('start_date', 'asc');

    // Verify that time periods were saved
    expect(savedPeriods.length).toBeGreaterThan(0);

    // Verify that at least one period has the correct structure
    const hasValidPeriod = savedPeriods.some(period => {
      return period.tenant === context.tenantId &&
             period.start_date instanceof Date &&
             period.end_date instanceof Date;
    });
    expect(hasValidPeriod).toBe(true);

    // Verify that the date range is covered
    const startDateExists = savedPeriods.some(period => 
      period.start_date.toISOString() === startDate
    );
    const endDateExists = savedPeriods.some(period => 
      period.end_date.toISOString() === expectedEndDateToExist
    );

    expect(startDateExists).toBe(true);
    expect(endDateExists).toBe(true);
  });
});
