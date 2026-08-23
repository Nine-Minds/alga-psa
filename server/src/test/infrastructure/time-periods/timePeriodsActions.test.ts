import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import {
  setupCommonMocks,
  mockNextHeaders,
  mockNextAuth,
  mockRBAC
} from '../../../../test-utils/testMocks';
import { v4 as uuidv4 } from 'uuid';
import { tenantDb } from '@alga-psa/db';
import { generateAndSaveTimePeriods, fetchAllTimePeriods } from '@alga-psa/scheduling/actions/timePeriodsActions';
import { ITimePeriodSettings } from 'server/src/interfaces/timeEntry.interfaces';
import { ISO8601String } from 'server/src/types/types.d';
import { TestContext } from '../../../../test-utils/testContext';
import {
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
import { toPlainDate } from 'server/src/lib/utils/dateTimeUtils';

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

describe('Time Periods Actions', () => {
  const context = new TestContext({
    cleanupTables: ['time_periods', 'time_period_settings'],
    runSeeds: true
  });
  let timePeriodSettingsId: string;

  function tenantTable(table: string) {
    return tenantDb(context.db, context.tenantId).table(table);
  }

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

    await tenantTable('time_period_settings').insert(withSettingsDefaults(settings));
  });

  // Use cleanup hook for test isolation
  afterEach(async () => {
    await createCleanupHook(context.db, [
      'time_periods',
      'time_period_settings'
    ])();
  });

  it('should generate and save time periods based on settings', async () => {
    // Arrange
    const startDate = '2026-01-01';
    const endDate = '2027-03-01';
    const expectedEndDateToExist = '2026-03-01';

    // Act
    const result = await generateAndSaveTimePeriods(startDate, endDate);
    const periods = await fetchAllTimePeriods();

    // Assert
    expect(result).toBeDefined();
    expect(result.length).toBeGreaterThan(0);

    // Verify the periods were saved to the database
    const savedPeriods = await tenantTable('time_periods')
      .orderBy('start_date', 'asc');

    // Verify that time periods were saved
    expect(savedPeriods.length).toBeGreaterThan(0);

    // Verify that at least one period has the correct structure
    const hasValidPeriod = savedPeriods.some(period => {
      if (period.tenant !== context.tenantId) return false;
      try {
        return Boolean(toPlainDate(period.start_date).toString()) && Boolean(toPlainDate(period.end_date).toString());
      } catch {
        return false;
      }
    });
    expect(hasValidPeriod).toBe(true);

    // Verify that the date range is covered
    const startDateExists = savedPeriods.some(period => 
      toPlainDate(period.start_date).toString() === startDate
    );
    const endDateExists = savedPeriods.some(period => 
      toPlainDate(period.end_date).toString() === expectedEndDateToExist
    );

    expect(startDateExists).toBe(true);
    expect(endDateExists).toBe(true);
  });
});
