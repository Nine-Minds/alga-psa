'use server'

import { revalidatePath } from 'next/cache'
import { TimePeriod } from '../models/timePeriod'
import { TimePeriodSettings } from '../models/timePeriodSettings';
import { v4 as uuidv4 } from 'uuid';
import { ISO8601String } from '../../types/types.d';
import { 
  ITimePeriod, 
  ITimePeriodView,
  ITimePeriodSettings 
} from '../../interfaces/timeEntry.interfaces';
import { TimePeriodSuggester } from '../timePeriodSuggester';
import { addDays, addMonths, format, differenceInHours, parseISO, startOfDay, formatISO, endOfMonth, AddMonthsOptions, differenceInDays } from 'date-fns';
import { fromZonedTime, toZonedTime } from 'date-fns-tz';
import { validateData, validateArray } from '../utils/validation';
import { timePeriodSchema, timePeriodSettingsSchema } from '../schemas/timeSheet.schemas';
import { formatUtcDateNoTime, toPlainDate } from '../utils/dateTimeUtils';
import { parse } from 'path';
import { Temporal } from '@js-temporal/polyfill';
import { createTenantKnex } from '../db';
import { withTransaction } from '@alga-psa/shared/db';
import { Knex } from 'knex';

// Special value to indicate end of period
const END_OF_PERIOD = 0;

export async function getLatestTimePeriod(): Promise<ITimePeriod | null> {
  try {
    const { knex } = await createTenantKnex();
    const latestPeriod = await TimePeriod.getLatest(knex);
    return latestPeriod ? validateData(timePeriodSchema, latestPeriod) as ITimePeriod : null;
  } catch (error) {
    console.error('Error fetching latest time period:', error)
    throw new Error('Failed to fetch latest time period')
  }
}

export async function getTimePeriodSettings(): Promise<ITimePeriodSettings[]> {
  try {
    const { knex } = await createTenantKnex();
    const settings = await TimePeriodSettings.getActiveSettings(knex);
    return validateArray(timePeriodSettingsSchema, settings) as ITimePeriodSettings[];
  } catch (error) {
    console.error('Error fetching time period settings:', error);
    throw new Error('Failed to fetch time period settings');
  }
}

export async function createTimePeriod(
  timePeriodData: Omit<ITimePeriod, 'period_id' | 'tenant'>
): Promise<ITimePeriod> {
  console.log('Starting createTimePeriod function with data:', timePeriodData);
  console.log('start_date type:', typeof timePeriodData.start_date);
  console.log('end_date type:', typeof timePeriodData.end_date);
  console.log('start_date value:', timePeriodData.start_date);
  console.log('end_date value:', timePeriodData.end_date);
  console.log('start_date constructor:', timePeriodData.start_date?.constructor?.name);
  console.log('end_date constructor:', timePeriodData.end_date?.constructor?.name);

  const { knex: db } = await createTenantKnex();
  return withTransaction(db, async (trx: Knex.Transaction) => {
    try {
      console.log('Fetching active time period settings...');
      const settings = await TimePeriodSettings.getActiveSettings(trx);
      const validatedSettings = validateArray(timePeriodSettingsSchema, settings) as ITimePeriodSettings[];
      console.log('Active settings fetched:', validatedSettings);

      const activeSetting = validatedSettings[0];
      console.log('Using active setting:', activeSetting);

      // Check for overlapping periods
      const overlappingPeriod = await TimePeriod.findOverlapping(trx, timePeriodData.start_date, timePeriodData.end_date);
      if (overlappingPeriod) {
        throw new Error('Cannot create time period: overlaps with existing period');
      }

      console.log('No overlapping periods found.');

      console.log('Creating new time period...');
      console.log('Data being sent to create:', {
        ...timePeriodData,
        start_date: timePeriodData.start_date,
        end_date: timePeriodData.end_date
      });

      const timePeriod = await TimePeriod.create(trx, timePeriodData);
      console.log('Time period created, before validation:', timePeriod);
      console.log('Time period start_date type:', typeof timePeriod.start_date);
      console.log('Time period end_date type:', typeof timePeriod.end_date);
      console.log('Time period start_date constructor:', timePeriod.start_date?.constructor?.name);
      console.log('Time period end_date constructor:', timePeriod.end_date?.constructor?.name);

      const validatedPeriod = validateData(timePeriodSchema, timePeriod) as ITimePeriod;
      console.log('Time period after validation:', validatedPeriod);
      console.log('Revalidating path: /msp/time-entry');
      revalidatePath('/msp/time-entry');

      console.log('createTimePeriod function completed successfully.');
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
    const validatedPeriods = validateArray(timePeriodSchema, timePeriods) as ITimePeriod[];

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
function getCurrentDate(): Temporal.PlainDate {
  return Temporal.Now.plainDateISO();
}

export async function getCurrentTimePeriod(): Promise<ITimePeriodView | null> {
  try {
    const { knex } = await createTenantKnex();
    const currentDate = getCurrentDate().toString();
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
  updates: Partial<Omit<ITimePeriod, 'period_id' | 'tenant'>>
): Promise<ITimePeriod> {
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
        const validatedPeriod = validateData(timePeriodSchema, updatedPeriod) as ITimePeriod;

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
      const validatedSettings = validateArray(timePeriodSettingsSchema, settings) as ITimePeriodSettings[];
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
      const validatedPeriods = validateArray(timePeriodSchema, savedPeriods) as ITimePeriod[];

      revalidatePath('/msp/time-entry');
      return validatedPeriods;
    } catch (error) {
      console.error('Error generating and saving time periods:', error);
      throw new Error('Failed to generate and save time periods');
    }
  });
}

export async function createNextTimePeriod(knexOrTrx: Knex | Knex.Transaction, settings: ITimePeriodSettings[], daysThreshold: number = 5): Promise<ITimePeriod | null> {
  try {
    // Get all existing time periods
    const existingPeriods = await fetchAllTimePeriods();
    
    if (!existingPeriods.length) {
      throw new Error('No existing time periods found');
    }

    // Convert view types to model types for comparison
    const modelPeriods = existingPeriods.map(period => ({
      ...period,
      start_date: toPlainDate(period.start_date),
      end_date: toPlainDate(period.end_date)
    }));

    // Get the latest period end date
    const lastPeriod = modelPeriods.sort((a, b) =>
      Temporal.PlainDate.compare(b.end_date, a.end_date)
    )[0];
    const newStartDate = lastPeriod.end_date;

    // Check if we're within the threshold days of the new period
    const currentDate = getCurrentDate();
    const daysUntilStart = Temporal.PlainDate.compare(newStartDate, currentDate);

    // Only create the period if we're within the threshold
    if (daysUntilStart > daysThreshold) {
      console.log(`Not creating new period: ${daysUntilStart} days until start date exceeds threshold of ${daysThreshold} days`);
      return null;
    }

    // Use TimePeriodSuggester to create the new period
    const newPeriodResult = TimePeriodSuggester.suggestNewTimePeriod(settings, modelPeriods);
    
    // Check if the suggestion was successful
    if (!newPeriodResult.success || !newPeriodResult.data) {
      throw new Error(`Failed to suggest new time period: ${newPeriodResult.error || 'Unknown error'}`);
    }
    
    // Convert string dates to Temporal.PlainDate
    const newPeriod = await createTimePeriod({
      start_date: toPlainDate(newPeriodResult.data.start_date),
      end_date: toPlainDate(newPeriodResult.data.end_date)
    });

    return newPeriod;
  } catch (error) {
    console.error('Error creating next time period:', error);
    throw error;
  }
}
