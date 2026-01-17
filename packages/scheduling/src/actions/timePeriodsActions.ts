'use server'

import { revalidatePath } from 'next/cache'
import { TimePeriod } from 'server/src/lib/models/timePeriod'
import { TimePeriodSettings } from 'server/src/lib/models/timePeriodSettings';
import { v4 as uuidv4 } from 'uuid';
import type { ISO8601String } from 'server/src/types/types.d';
import {
  ITimePeriod,
  ITimePeriodView,
  ITimePeriodSettings
} from 'server/src/interfaces/timeEntry.interfaces';
import { TimePeriodSuggester } from 'server/src/lib/timePeriodSuggester';
import { addDays, addMonths, format, differenceInHours, parseISO, startOfDay, formatISO, endOfMonth, AddMonthsOptions, differenceInDays } from 'date-fns';
import { fromZonedTime, toZonedTime } from 'date-fns-tz';
import { validateData, validateArray } from '@alga-psa/validation';
import { timePeriodSchema, timePeriodSettingsSchema } from 'server/src/lib/schemas/timeSheet.schemas';
import { formatUtcDateNoTime, toPlainDate } from 'server/src/lib/utils/dateTimeUtils';
import { parse } from 'path';
import { Temporal } from '@js-temporal/polyfill';
import { createTenantKnex, withTransaction } from '@alga-psa/db';
import { Knex } from 'knex';
import logger from '@alga-psa/core/logger';
import { getSession } from 'server/src/lib/auth/getSession';
import { resolveUserTimeZone } from 'server/src/lib/utils/workDate';

// Special value to indicate end of period
const END_OF_PERIOD = 0;

// Input type for server actions - accepts string dates (Next.js can't serialize Temporal.PlainDate)
interface TimePeriodInput {
  start_date: string;
  end_date: string;
}

export async function getLatestTimePeriod(): Promise<ITimePeriod | null> {
  try {
    const { knex } = await createTenantKnex();
    const latestPeriod = await TimePeriod.getLatest(knex);
    return latestPeriod ? validateData(timePeriodSchema, latestPeriod) : null;
  } catch (error) {
    console.error('Error fetching latest time period:', error)
    throw new Error('Failed to fetch latest time period')
  }
}

export async function getTimePeriodSettings(): Promise<ITimePeriodSettings[]> {
  try {
    const { knex } = await createTenantKnex();
    const settings = await TimePeriodSettings.getActiveSettings(knex);
    return validateArray(timePeriodSettingsSchema, settings);
  } catch (error) {
    console.error('Error fetching time period settings:', error);
    throw new Error('Failed to fetch time period settings');
  }
}

export async function createTimePeriod(
  input: TimePeriodInput
): Promise<ITimePeriod> {
  // Convert string dates to Temporal.PlainDate (Next.js server actions can't receive Temporal objects)
  const timePeriodData = {
    start_date: toPlainDate(input.start_date),
    end_date: toPlainDate(input.end_date)
  };

  const { knex: db } = await createTenantKnex();
  return withTransaction(db, async (trx: Knex.Transaction) => {
    try {
      const settings = await TimePeriodSettings.getActiveSettings(trx);
      const validatedSettings = validateArray(timePeriodSettingsSchema, settings);

      // Check for overlapping periods
      const overlappingPeriod = await TimePeriod.findOverlapping(trx, timePeriodData.start_date, timePeriodData.end_date);
      if (overlappingPeriod) {
        throw new Error('Cannot create time period: overlaps with existing period');
      }

      const timePeriod = await TimePeriod.create(trx, timePeriodData);
      const validatedPeriod = validateData(timePeriodSchema, timePeriod);

      // revalidatePath only works in request context, not from background jobs
      try {
        revalidatePath('/msp/time-entry');
      } catch {
        // Ignore revalidation errors when called outside request context (e.g., from jobs)
      }

      return validatedPeriod;
    } catch (error) {
      console.error('Error in createTimePeriod function:', error);
      throw error;
    }
  });
}

export async function fetchAllTimePeriods(): Promise<ITimePeriodView[]> {
  try {
    console.log('Fetching all time periods...');

    const { knex } = await createTenantKnex();
    const timePeriods = await TimePeriod.getAll(knex);

    // Convert model types to view types
    const periods = timePeriods.map((period: ITimePeriod): ITimePeriodView => ({
      ...period,
      start_date: period.start_date.toString(),  // Convert to string for view
      end_date: period.end_date.toString()       // Convert to string for view
    }));

    console.log('periods', periods);

    // Validate as model type first
    const validatedPeriods = validateArray(timePeriodSchema, timePeriods);
    
    // Then convert to view type
    return validatedPeriods.map((period): ITimePeriodView => ({
      ...period,
      start_date: period.start_date.toString(),
      end_date: period.end_date.toString()
    }));
  } catch (error) {
    console.error('Error fetching all time periods:', error)
    throw new Error('Failed to fetch time periods')
  }
}

// Utility function to get current date as Temporal.PlainDate
function getCurrentDate(timeZone: string): Temporal.PlainDate {
  return Temporal.Now.plainDateISO(timeZone);
}

// Internal helper: fetch all time periods using provided transaction (for use within transactions)
// Note: TimePeriod.getAll() internally filters by tenant via getCurrentTenantId()
async function fetchAllTimePeriodsWithTrx(trx: Knex | Knex.Transaction): Promise<ITimePeriodView[]> {
  const timePeriods = await TimePeriod.getAll(trx);

  // Validate and convert to view type
  const validatedPeriods = validateArray(timePeriodSchema, timePeriods);
  return validatedPeriods.map((period): ITimePeriodView => ({
    ...period,
    start_date: period.start_date.toString(),
    end_date: period.end_date.toString()
  }));
}

// Internal helper: create time period using provided transaction (for use within transactions)
async function createTimePeriodWithTrx(
  trx: Knex | Knex.Transaction,
  timePeriodData: Omit<ITimePeriod, 'period_id' | 'tenant'>
): Promise<ITimePeriod> {
  // Check for overlapping periods
  const overlappingPeriod = await TimePeriod.findOverlapping(trx, timePeriodData.start_date, timePeriodData.end_date);
  if (overlappingPeriod) {
    throw new Error('Cannot create time period: overlaps with existing period');
  }

  const timePeriod = await TimePeriod.create(trx, timePeriodData);
  return validateData(timePeriodSchema, timePeriod);
}

// Type for periods with Temporal.PlainDate (not string)
interface ITimePeriodWithPlainDate extends Omit<ITimePeriod, 'start_date' | 'end_date'> {
  start_date: Temporal.PlainDate;
  end_date: Temporal.PlainDate;
}

// Helper to convert view periods to model periods with Temporal.PlainDate
function toModelPeriodsWithPlainDate(periods: ITimePeriodView[]): ITimePeriodWithPlainDate[] {
  return periods.map(period => ({
    ...period,
    start_date: toPlainDate(period.start_date),
    end_date: toPlainDate(period.end_date)
  }));
}

export async function getCurrentTimePeriod(): Promise<ITimePeriodView | null> {
  try {
    const { knex, tenant } = await createTenantKnex();
    const session = await getSession();

    const userId = session?.user?.id || null;
    const userTimeZone = tenant && userId ? await resolveUserTimeZone(knex, tenant, userId) : 'UTC';

    const currentDate = getCurrentDate(userTimeZone).toString();
    const currentPeriod = await TimePeriod.findByDate(knex, currentDate);
    if (!currentPeriod) return null;

    // Convert Temporal.PlainDate to string for view type
    return {
      ...currentPeriod,
      start_date: currentPeriod.start_date.toString(),
      end_date: currentPeriod.end_date.toString()
    };
  } catch (error) {
    console.error('Error fetching current time period:', error)
    throw new Error('Failed to fetch current time period')
  }
}

// Helper function to get the end of a period based on frequency unit
function getEndOfPeriod(startDate: string, setting: ITimePeriodSettings): Temporal.PlainDate {
  const frequency = setting.frequency || 1;
  const startDatePlain = Temporal.PlainDate.from(startDate);

  // Special handling for frequency = 0 (end of period)
  if (frequency === END_OF_PERIOD) {
    switch (setting.frequency_unit) {
      case 'week': {
        // End of week (Sunday) + 1 day
        const daysUntilEndOfWeek = 7 - startDatePlain.dayOfWeek;
        return startDatePlain.add({ days: daysUntilEndOfWeek + 1 });
      }

      case 'month': {
        // End of month + 1 day
        return startDatePlain.add({ months: 1 }).with({ day: 1 });
      }
      case 'year': {
        return startDatePlain.add({ years: 1 }).with({ month: 1, day: 1 });
      }

      default: // day
        return startDatePlain.add({ days: 1 });
    }
  }

  // Regular frequency handling
  switch (setting.frequency_unit) {
    case 'week':
      return startDatePlain.add({ days: 7 * frequency });

    case 'month': {
      if (setting.end_day && setting.end_day !== END_OF_PERIOD) {
        return startDatePlain.add({ months: frequency - 1 }).with({ day: setting.end_day });
      }
      return startDatePlain.add({ months: frequency }).with({ day: 1 });
    }

    case 'year': {
      return startDatePlain.add({ years: frequency });
    }

    default: // day
      return startDatePlain.add({ days: frequency });
  }
}

// Modify the generateTimePeriods function
export async function generateTimePeriods(
  settings: ITimePeriodSettings[],
  startDateStr: ISO8601String,
  endDateStr: ISO8601String
): Promise<ITimePeriodView[]> {
  const periods: ITimePeriodView[] = [];
  const startDate = toPlainDate(startDateStr);
  const endDate = toPlainDate(endDateStr);

  for (const setting of settings) {
    let currentDate = startDate;

    if (setting.effective_from) {
      const effectiveFrom = toPlainDate(setting.effective_from);
      if (Temporal.PlainDate.compare(currentDate, effectiveFrom) < 0) {
        currentDate = effectiveFrom;
      }
    }

    // Align currentDate to the next occurrence of start_day if provided
    if (setting.start_day !== undefined && setting.frequency_unit !== 'year') {
      switch (setting.frequency_unit) {
        case 'week':
          currentDate = Temporal.PlainDate.from(alignToWeekday(currentDate.toString(), setting.start_day));
          break;
        case 'month':
          currentDate = Temporal.PlainDate.from(alignToMonthDay(currentDate.toString(), setting.start_day));
          break;
      }
    }

    while (Temporal.PlainDate.compare(currentDate, endDate) < 0) {
      if (setting.effective_to) {
        const effectiveTo = toPlainDate(setting.effective_to);
        if (Temporal.PlainDate.compare(currentDate, effectiveTo) > 0) {
          break;
        }
      }

      const periodEndDate = getEndOfPeriod(currentDate.toString(), setting);

      if (Temporal.PlainDate.compare(periodEndDate, endDate) >= 0) {
        break;
      }

      if (setting.effective_to) {
        const effectiveTo = toPlainDate(setting.effective_to);
        if (Temporal.PlainDate.compare(periodEndDate, effectiveTo) >= 0) {
          break;
        }
      }

      const newPeriod: ITimePeriodView = {
        period_id: uuidv4(),
        start_date: currentDate.toString(),
        end_date: periodEndDate.toString(),
        tenant: setting.tenant,
      };
      periods.push(newPeriod);

      if (setting.end_day !== END_OF_PERIOD) {
        // if the end day is not END_OF_PERIOD, we need to adjust the current date to the end of the period
        currentDate = periodEndDate;
        continue;
      }

      currentDate = periodEndDate;
    }
  }

  return periods;
}

// Helper function to align date to the next occurrence of a weekday
function alignToWeekday(dateStr: string, targetDay: number): string {
  const date = Temporal.PlainDate.from(dateStr);
  const daysToAdd = (targetDay - date.dayOfWeek + 7) % 7;
  return date.add({ days: daysToAdd }).toString();
}

// Helper function to align date to the specified day of the month
function alignToMonthDay(dateStr: string, targetDay: number): string {
  const date = Temporal.PlainDate.from(dateStr);
  let alignedDate = date.with({ day: targetDay });

  if (Temporal.PlainDate.compare(alignedDate, date) < 0) {
    // Move to next month
    alignedDate = alignedDate.add({ months: 1 });
  }

  return alignedDate.toString();
}

export async function deleteTimePeriod(periodId: string): Promise<void> {
  try {
    const { knex } = await createTenantKnex();
    // Check if period exists and has no associated time records
    const period = await TimePeriod.findById(knex, periodId);
    if (!period) {
      throw new Error('Time period not found');
    }

    const isEditable = await TimePeriod.isEditable(knex, periodId);
    if (!isEditable) {
      throw new Error('Cannot delete time period with associated time sheets');
    }

    try {
      await TimePeriod.delete(knex, periodId);
      revalidatePath('/msp/time-entry');
    } catch (error: any) {
      if (error.message.includes('belongs to different tenant')) {
        throw new Error('Access denied: Cannot delete time period');
      }
      console.error('Error deleting time period:', error);
      throw error;
    }
  } catch (error) {
    console.error('Error in deleteTimePeriod:', error);
    throw error;
  }
}

export async function updateTimePeriod(
  periodId: string,
  input: Partial<TimePeriodInput>
): Promise<ITimePeriod> {
  // Convert string dates to Temporal.PlainDate (Next.js server actions can't receive Temporal objects)
  const updates: Partial<Omit<ITimePeriod, 'period_id' | 'tenant'>> = {};
  if (input.start_date) updates.start_date = toPlainDate(input.start_date);
  if (input.end_date) updates.end_date = toPlainDate(input.end_date);

  const { knex: db } = await createTenantKnex();
  return withTransaction(db, async (trx: Knex.Transaction) => {
    try {
      // Check if period exists and has no associated time records
      const period = await TimePeriod.findById(trx, periodId);
      if (!period) {
        throw new Error('Time period not found');
      }

      const isEditable = await TimePeriod.isEditable(trx, periodId);
      if (!isEditable) {
        throw new Error('Cannot update time period with associated time sheets');
      }

      // Check for overlapping periods
      if (updates.start_date || updates.end_date) {
        const startDate = updates.start_date || period.start_date;
        const endDate = updates.end_date || period.end_date;
        const overlappingPeriod = await TimePeriod.findOverlapping(trx, startDate, endDate, periodId);
        if (overlappingPeriod) {
          throw new Error('Cannot update time period: overlaps with existing period');
        }
      }

      try {
        const updatedPeriod = await TimePeriod.update(trx, periodId, updates);
        const validatedPeriod = validateData(timePeriodSchema, updatedPeriod);

        revalidatePath('/msp/time-entry');
        return validatedPeriod;
      } catch (error: any) {
        if (error.message.includes('belongs to different tenant')) {
          throw new Error('Access denied: Cannot update time period');
        }
        console.error('Error updating time period:', error);
        throw error;
      }
    } catch (error) {
      console.error('Error in updateTimePeriod:', error);
      throw error;
    }
  });
}

export async function generateAndSaveTimePeriods(startDate: ISO8601String, endDate: ISO8601String): Promise<ITimePeriod[]> {
  const { knex: db } = await createTenantKnex();
  return withTransaction(db, async (trx: Knex.Transaction) => {
    try {
      const settings = await getTimePeriodSettings();
      const validatedSettings = validateArray(timePeriodSettingsSchema, settings);
      const generatedPeriods = await generateTimePeriods(validatedSettings, startDate, endDate);

      // Check for overlapping periods before saving
      for (const period of generatedPeriods) {
        const overlappingPeriod = await TimePeriod.findOverlapping(
          trx,
          toPlainDate(period.start_date),
          toPlainDate(period.end_date)
        );
        if (overlappingPeriod) {
          throw new Error(`Cannot create time period: overlaps with existing period from ${overlappingPeriod.start_date} to ${overlappingPeriod.end_date}`);
        }
      }

      // Save generated periods to the database
      const savedPeriods = await Promise.all(generatedPeriods.map((period: ITimePeriodView): Promise<ITimePeriod> => {
        // Convert string dates to Temporal.PlainDate for database
        return TimePeriod.create(trx, {
          ...period,
          start_date: toPlainDate(period.start_date),
          end_date: toPlainDate(period.end_date)
        });
      }));
      const validatedPeriods = validateArray(timePeriodSchema, savedPeriods);

      revalidatePath('/msp/time-entry');
      return validatedPeriods;
    } catch (error) {
      console.error('Error generating and saving time periods:', error);
      throw new Error('Failed to generate and save time periods');
    }
  });
}

/**
 * Creates the next time period(s) based on settings, filling any gaps up to the threshold.
 *
 * This function manages its own transaction internally to ensure atomicity - either all
 * periods are created or none are. It uses createTenantKnex() to get a pooled connection.
 *
 * @param settings - Time period settings to use for generation
 * @param daysThreshold - How many days ahead to create periods (default: 5)
 */
export async function createNextTimePeriod(
  settings: ITimePeriodSettings[],
  daysThreshold: number = 5
): Promise<ITimePeriod | null> {
  // Safety limit to prevent infinite loops (max 1 year of weekly periods)
  const MAX_PERIODS_PER_RUN = 52;

  const { knex: db } = await createTenantKnex();

  try {
    return await withTransaction(db, async (trx) => {
      // Use UTC for background jobs since there's no user session
      const currentDate = getCurrentDate('UTC');
      const createdPeriods: ITimePeriod[] = [];

      // Get initial existing time periods using the transaction
      const existingPeriods = await fetchAllTimePeriodsWithTrx(trx);
      // Keep model periods in memory to avoid repeated DB queries
      const modelPeriods: ITimePeriodWithPlainDate[] = toModelPeriodsWithPlainDate(existingPeriods);

      // Track the latest end date to avoid repeated sorting
      let latestEndDate: Temporal.PlainDate | null = modelPeriods.length > 0
        ? modelPeriods.reduce((max, p) =>
            Temporal.PlainDate.compare(p.end_date, max) > 0 ? p.end_date : max,
            modelPeriods[0].end_date
          )
        : null;

      // Handle first period creation (bootstrapping)
      if (!existingPeriods.length) {
        logger.info('No existing time periods found. Creating initial time period based on settings.');
        logger.debug('Available settings:', { settings: settings.map(s => ({
          start_day: s.start_day,
          end_day: s.end_day,
          frequency_unit: s.frequency_unit
        }))});

        // Use TimePeriodSuggester with empty periods to create the first period
        const newPeriodResult = TimePeriodSuggester.suggestNewTimePeriod(settings, []);

        if (!newPeriodResult.success || !newPeriodResult.data) {
          logger.info(`Cannot create initial time period: ${newPeriodResult.error || 'Unknown reason'}`);
          return null;
        }

        // Create the first period using the transaction
        const newPeriod = await createTimePeriodWithTrx(trx, {
          start_date: toPlainDate(newPeriodResult.data.start_date),
          end_date: toPlainDate(newPeriodResult.data.end_date)
        });

        logger.info(`Created initial time period: ${newPeriod.start_date} to ${newPeriod.end_date}`);
        createdPeriods.push(newPeriod);

        // Add the new period to our in-memory list and update latest end date
        const newPeriodWithPlainDate: ITimePeriodWithPlainDate = {
          ...newPeriod,
          start_date: toPlainDate(newPeriod.start_date),
          end_date: toPlainDate(newPeriod.end_date)
        };
        modelPeriods.push(newPeriodWithPlainDate);
        latestEndDate = newPeriodWithPlainDate.end_date;
      }

      // Loop to fill any gaps - keep creating periods until we're caught up
      // Note: latestEndDate is always set after bootstrapping, but we keep the null check
      // as defensive programming in case the loop is entered without existing periods
      for (let i = 0; i < MAX_PERIODS_PER_RUN && latestEndDate; i++) {
        const newStartDate = latestEndDate;

        // Calculate days from today to the next period's start
        // Positive = future, negative = past (gap that needs filling)
        const daysFromToday = newStartDate.since(currentDate, { largestUnit: 'day' }).days;

        // Stop if the next period's start date is too far in the future
        if (daysFromToday > daysThreshold) {
          if (createdPeriods.length === 0) {
            logger.debug(`Not creating new period: next start date is ${daysFromToday} days from today (threshold: ${daysThreshold})`);
          } else {
            logger.info(`Stopped after creating ${createdPeriods.length} period(s). Next start date is ${daysFromToday} days from today (threshold: ${daysThreshold})`);
          }
          break;
        }

        logger.debug(`Creating period ${createdPeriods.length + 1}: start date ${daysFromToday} days from today, last period ends: ${latestEndDate}`);

        // Use TimePeriodSuggester to create the new period
        const newPeriodResult = TimePeriodSuggester.suggestNewTimePeriod(settings, modelPeriods);

        // Check if the suggestion was successful
        if (!newPeriodResult.success || !newPeriodResult.data) {
          // "No applicable settings" is not an error - it means no period should be created
          logger.info(`No time period to create: ${newPeriodResult.error || 'Unknown reason'}`);
          break;
        }

        // Create the period using the transaction
        const newPeriod = await createTimePeriodWithTrx(trx, {
          start_date: toPlainDate(newPeriodResult.data.start_date),
          end_date: toPlainDate(newPeriodResult.data.end_date)
        });

        createdPeriods.push(newPeriod);

        // Add the new period to our in-memory list and update latest end date
        const newPeriodWithPlainDate: ITimePeriodWithPlainDate = {
          ...newPeriod,
          start_date: toPlainDate(newPeriod.start_date),
          end_date: toPlainDate(newPeriod.end_date)
        };
        modelPeriods.push(newPeriodWithPlainDate);
        latestEndDate = newPeriodWithPlainDate.end_date;

        logger.debug(`Created time period: ${newPeriod.start_date} to ${newPeriod.end_date}`);
      }

      if (createdPeriods.length >= MAX_PERIODS_PER_RUN) {
        logger.warn(`Hit maximum periods per run limit (${MAX_PERIODS_PER_RUN}). There may be more gaps to fill.`);
      }

      if (createdPeriods.length > 0) {
        logger.info(`Time period creation completed: created ${createdPeriods.length} period(s)`);
      }

      // Return the last created period, or null if none were created
      return createdPeriods.length > 0 ? createdPeriods[createdPeriods.length - 1] : null;
    });
  } catch (error) {
    logger.error('Error creating next time period:', error);
    throw error;
  }
}
