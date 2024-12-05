'use server'

import { revalidatePath } from 'next/cache'
import { TimePeriod } from '../models/timePeriod'
import { TimePeriodSettings } from '../models/timePeriodSettings';
import { v4 as uuidv4 } from 'uuid';
import { ISO8601String } from '../../types/types.d';
import { ITimePeriod, ITimePeriodSettings } from '../../interfaces/timeEntry.interfaces';
import { addDays, addMonths, format, differenceInHours, parseISO, startOfDay, formatISO, endOfMonth, AddMonthsOptions } from 'date-fns';
import { fromZonedTime, toZonedTime } from 'date-fns-tz';
import { validateData, validateArray } from '../utils/validation';
import { timePeriodSchema, timePeriodSettingsSchema } from '../schemas/timeSheet.schemas';
import { formatUtcDateNoTime } from '../utils/dateTimeUtils';
import { parse } from 'path';

// Special value to indicate end of period
const END_OF_PERIOD = 0;

export async function getLatestTimePeriod(): Promise<ITimePeriod | null> {
  try {
    const latestPeriod = await TimePeriod.getLatest();
    return latestPeriod ? validateData(timePeriodSchema, latestPeriod) : null;
  } catch (error) {
    console.error('Error fetching latest time period:', error)
    throw new Error('Failed to fetch latest time period')
  }
}

export async function getTimePeriodSettings(): Promise<ITimePeriodSettings[]> {
  try {
    const settings = await TimePeriodSettings.getActiveSettings();
    return validateArray(timePeriodSettingsSchema, settings);
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

  try {
    console.log('Fetching active time period settings...');
    const settings = await TimePeriodSettings.getActiveSettings();
    const validatedSettings = validateArray(timePeriodSettingsSchema, settings);
    console.log('Active settings fetched:', validatedSettings);

    const activeSetting = validatedSettings[0];
    console.log('Using active setting:', activeSetting);

    // Check for overlapping periods
    const overlappingPeriod = await TimePeriod.findOverlapping(timePeriodData.start_date, timePeriodData.end_date);
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

    const timePeriod = await TimePeriod.create(timePeriodData);
    console.log('Time period created, before validation:', timePeriod);
    console.log('Time period start_date type:', typeof timePeriod.start_date);
    console.log('Time period end_date type:', typeof timePeriod.end_date);
    console.log('Time period start_date constructor:', timePeriod.start_date?.constructor?.name);
    console.log('Time period end_date constructor:', timePeriod.end_date?.constructor?.name);

    const validatedPeriod = validateData(timePeriodSchema, timePeriod);
    console.log('Time period after validation:', validatedPeriod);
    console.log('Revalidating path: /msp/time-entry');
    revalidatePath('/msp/time-entry');

    console.log('createTimePeriod function completed successfully.');
    return validatedPeriod;
  } catch (error) {
    console.error('Error in createTimePeriod function:', error);
    throw error;
  }
}

export async function fetchAllTimePeriods(): Promise<ITimePeriod[]> {
  try {
    console.log('Fetching all time periods...');

    const timePeriods = await TimePeriod.getAll();

    const periods = timePeriods.map((period: ITimePeriod): ITimePeriod => {
      const startDate = new Date(period.start_date);
      const endDate = new Date(period.end_date);

      return {
        ...period,
        start_date: formatUtcDateNoTime(startDate),
        end_date: formatUtcDateNoTime(endDate)
      };
    });

    console.log('periods', periods);

    return validateArray(timePeriodSchema, periods);
  } catch (error) {
    console.error('Error fetching all time periods:', error)
    throw new Error('Failed to fetch time periods')
  }
}

// Utility function to get current date as ISO8601 string
function getCurrentDateISO(): ISO8601String {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  const day = String(now.getUTCDate()).padStart(2, '0');
  const hours = String(now.getUTCHours()).padStart(2, '0');
  const minutes = String(now.getUTCMinutes()).padStart(2, '0');
  const seconds = String(now.getUTCSeconds()).padStart(2, '0');
  const milliseconds = String(now.getUTCMilliseconds()).padStart(3, '0');

  return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}.${milliseconds}Z`;
}

export async function getCurrentTimePeriod(): Promise<ITimePeriod | null> {
  try {
    const currentDate = getCurrentDateISO();
    const currentPeriod = await TimePeriod.findByDate(currentDate);
    return currentPeriod ? validateData(timePeriodSchema, currentPeriod) : null;
  } catch (error) {
    console.error('Error fetching current time period:', error)
    throw new Error('Failed to fetch current time period')
  }
}

// Helper function to get the end of a period based on frequency unit
function getEndOfPeriod(startDate: ISO8601String, setting: ITimePeriodSettings): Date {
  const frequency = setting.frequency || 1;
  const startDateObj = parseISO(startDate);

  // Special handling for frequency = 0 (end of period)
  if (frequency === END_OF_PERIOD) {
    switch (setting.frequency_unit) {
      case 'week': {
        // End of week (Sunday) + 1 day
        const daysUntilEndOfWeek = 7 - startDateObj.getUTCDay();
        return addDays(startDateObj, daysUntilEndOfWeek + 1);
      }

      case 'month': {
        // End of month + 1 day
        const nextMonth = new Date(startDateObj);
        nextMonth.setUTCMonth(startDateObj.getUTCMonth() + 1, 1);
        return nextMonth;
      }
      case 'year': {
        const nextYear = new Date(startDateObj);
        nextYear.setUTCFullYear(startDateObj.getUTCFullYear() + 1, 0, 1);
        return nextYear;
      }

      default: // day
        return addDays(startDateObj, 1);
    }
  }

  // Regular frequency handling
  switch (setting.frequency_unit) {
    case 'week':
      return addDays(startDateObj, 7 * frequency);

    case 'month': {
      let year = startDateObj.getUTCFullYear();
      let month = startDateObj.getUTCMonth() + frequency;

      if (setting.end_day && setting.end_day !== END_OF_PERIOD) {
        const endDateObj = new Date(startDate);
        endDateObj.setUTCFullYear(year);
        endDateObj.setUTCMonth(month-1);
        endDateObj.setUTCDate(setting.end_day!);
        return endDateObj;
      }

      if (month >= 12) {
        const additionalYears = Math.floor(month / 12);
        year += additionalYears;
        month = month % 12;
      }

      const endDateObj = new Date(startDate);
      endDateObj.setUTCFullYear(year);
      endDateObj.setUTCMonth(month);
      endDateObj.setUTCDate(1);

      return endDateObj;
    }

    case 'year': {
      const nextPeriodStart = new Date(startDate);
      nextPeriodStart.setUTCFullYear(startDateObj.getUTCFullYear() + frequency);
      return nextPeriodStart;
    }

    default: // day
      return addDays(startDateObj, frequency);
  }
}

// Modify the generateTimePeriods function
export async function generateTimePeriods(
  settings: ITimePeriodSettings[],
  startDateStr: ISO8601String,
  endDateStr: ISO8601String
): Promise<ITimePeriod[]> {
  const periods: ITimePeriod[] = [];

  for (const setting of settings) {
    let currentDateStr = startDateStr;

    if (currentDateStr < setting.effective_from) {
      currentDateStr = setting.effective_from;
    }

    // Align currentDate to the next occurrence of start_day if provided
    if (setting.start_day !== undefined && setting.frequency_unit !== 'year') {
      switch (setting.frequency_unit) {
        case 'week':
          currentDateStr = alignToWeekday(currentDateStr, setting.start_day);
          break;
        case 'month':
          currentDateStr = alignToMonthDay(currentDateStr, setting.start_day);
          break;
      }
    }

    while (currentDateStr < endDateStr) {
      if (setting.effective_to && currentDateStr > setting.effective_to) {
        break;
      }

      const currentDateObj = parseISO(currentDateStr);
      const periodStartDate = formatUtcDateNoTime(currentDateObj);
      const periodEndDateObj = getEndOfPeriod(periodStartDate, setting);
      const periodEndStr = formatUtcDateNoTime(periodEndDateObj);

      if (periodEndStr >= endDateStr) {
        break;
      }

      if (setting.effective_to && periodEndStr >= setting.effective_to) {
        break;
      }

      const newPeriod: ITimePeriod = {
        period_id: uuidv4(),
        start_date: periodStartDate,
        end_date: periodEndStr,
        tenant: setting.tenant_id,
      };
      periods.push(newPeriod);

      if (setting.end_day !== END_OF_PERIOD) {
        // if the end day is not END_OF_PERIOD, we need to adjust the current date to the end of the period
        // and continue to the next period, the other portion of the current period will be handled in the next iteration of the parent loop
        currentDateStr = formatUtcDateNoTime(getEndOfPeriod(periodEndStr, {...setting, end_day: END_OF_PERIOD})); 
        continue;
      }

      currentDateStr = periodEndStr;
    }
  }

  return periods;
}

function getFirstDayOfNextMonth(dateStr: ISO8601String, monthsToAdvance: number = 1): ISO8601String {
  const date = new Date(dateStr);
  date.setUTCMonth(date.getUTCMonth() + monthsToAdvance, 1);
  date.setUTCHours(0, 0, 0, 0);
  return date.toISOString() as ISO8601String;
}

// Helper function to align date to the next occurrence of a weekday
function alignToWeekday(dateStr: ISO8601String, targetDay: number): ISO8601String {
  const dayOfWeek = getDayOfWeek(dateStr);
  const daysToAdd = (targetDay - dayOfWeek + 7) % 7;
  return addDaysToISOString(dateStr, daysToAdd);
}

// Helper function to align date to the specified day of the month
function alignToMonthDay(dateStr: ISO8601String, targetDay: number): ISO8601String {
  const [year, month] = dateStr.split('-');
  let alignedDate = `${year}-${month}-${String(targetDay).padStart(2, '0')}T00:00:00Z`;

  if (alignedDate < dateStr) {
    // Move to next month
    alignedDate = addMonthsToISOString(alignedDate, 1);
  }

  const daysInMonth = getDaysInMonth(alignedDate);

  if (targetDay > daysInMonth) {
    // Set to last day of month
    alignedDate = `${year}-${month}-${String(daysInMonth).padStart(2, '0')}T00:00:00Z`;
  }

  return alignedDate as ISO8601String;
}

// Adjust end date to the last day of the month if necessary
function adjustEndDateForMonth(dateStr: ISO8601String): ISO8601String {
  const [year, month, day] = dateStr.split('T')[0].split('-').map(Number);
  const daysInMonth = getDaysInMonth(dateStr);

  if (day > daysInMonth) {
    return `${year}-${String(month).padStart(2, '0')}-${String(daysInMonth).padStart(2, '0')}T23:59:59.999Z`;
  }

  return dateStr;
}

// Helper function to add days to an ISO8601 string
function addDaysToISOString(dateStr: ISO8601String, days: number): ISO8601String {
  const [datePart, timePart] = dateStr.split('T');
  const [year, month, day] = datePart.split('-').map(Number);

  let newYear = year;
  let newMonth = month;
  let newDay = day + days;

  while (newDay > getDaysInMonth(`${newYear}-${String(newMonth).padStart(2, '0')}-01T00:00:00Z`)) {
    newDay -= getDaysInMonth(`${newYear}-${String(newMonth).padStart(2, '0')}-01T00:00:00Z`);
    newMonth++;
    if (newMonth > 12) {
      newMonth = 1;
      newYear++;
    }
  }

  while (newDay < 1) {
    newMonth--;
    if (newMonth < 1) {
      newMonth = 12;
      newYear--;
    }
    newDay += getDaysInMonth(`${newYear}-${String(newMonth).padStart(2, '0')}-01T00:00:00Z`);
  }

  return `${newYear}-${String(newMonth).padStart(2, '0')}-${String(newDay).padStart(2, '0')}T${timePart}`;
}

// Helper function to add months to an ISO8601 string
function addMonthsToISOString(dateStr: ISO8601String, months: number): ISO8601String {
  return format(toZonedTime(addMonths(dateStr, months), 'UTC'), "yyyy-MM-dd'T'HH:mm:ss'Z'") as ISO8601String;
}

// Helper function to get the day of the week (0-6, where 0 is Sunday)
function getDayOfWeek(dateStr: ISO8601String): number {
  const [year, month, day] = dateStr.split('T')[0].split('-').map(Number);
  const a = Math.floor((14 - month) / 12);
  const y = year - a;
  const m = month + 12 * a - 2;
  return (day + y + Math.floor(y / 4) - Math.floor(y / 100) + Math.floor(y / 400) + Math.floor((31 * m) / 12)) % 7;
}

// Helper function to get the number of days in a month
function getDaysInMonth(dateStr: ISO8601String): number {
  const [year, month] = dateStr.split('-').map(Number);
  const isLeapYear = (year % 4 === 0 && year % 100 !== 0) || (year % 400 === 0);
  const daysInMonth = [31, isLeapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return daysInMonth[month - 1];
}

function alignToNearestMidnight(dateStr: ISO8601String): ISO8601String {
  const parsedDate = parseISO(dateStr);
  const previousMidnight = startOfDay(parsedDate);
  const nextMidnight = addDays(previousMidnight, 1);

  const hoursToPreviousMidnight = differenceInHours(parsedDate, previousMidnight);
  const hoursToNextMidnight = differenceInHours(nextMidnight, parsedDate);

  const nearestMidnight = hoursToPreviousMidnight <= hoursToNextMidnight ? previousMidnight : nextMidnight;

  return format(nearestMidnight, "yyyy-MM-dd'T'HH:mm:ss'Z'") as ISO8601String;
}

export async function deleteTimePeriod(periodId: string): Promise<void> {
  try {
    // Check if period exists and has no associated time records
    const period = await TimePeriod.findById(periodId);
    if (!period) {
      throw new Error('Time period not found');
    }

    const isEditable = await TimePeriod.isEditable(periodId);
    if (!isEditable) {
      throw new Error('Cannot delete time period with associated time sheets');
    }

    await TimePeriod.delete(periodId);
    revalidatePath('/msp/time-entry');
  } catch (error) {
    console.error('Error deleting time period:', error);
    throw error;
  }
}

export async function updateTimePeriod(
  periodId: string,
  updates: Partial<Omit<ITimePeriod, 'period_id' | 'tenant'>>
): Promise<ITimePeriod> {
  try {
    // Check if period exists and has no associated time records
    const period = await TimePeriod.findById(periodId);
    if (!period) {
      throw new Error('Time period not found');
    }

    const isEditable = await TimePeriod.isEditable(periodId);
    if (!isEditable) {
      throw new Error('Cannot update time period with associated time sheets');
    }

    // Check for overlapping periods
    if (updates.start_date || updates.end_date) {
      const startDate = updates.start_date || period.start_date;
      const endDate = updates.end_date || period.end_date;
      const overlappingPeriod = await TimePeriod.findOverlapping(startDate, endDate, periodId);
      if (overlappingPeriod) {
        throw new Error('Cannot update time period: overlaps with existing period');
      }
    }

    const updatedPeriod = await TimePeriod.update(periodId, updates);
    const validatedPeriod = validateData(timePeriodSchema, updatedPeriod);

    revalidatePath('/msp/time-entry');
    return validatedPeriod;
  } catch (error) {
    console.error('Error updating time period:', error);
    throw error;
  }
}

export async function generateAndSaveTimePeriods(startDate: ISO8601String, endDate: ISO8601String): Promise<ITimePeriod[]> {
  try {
    const settings = await getTimePeriodSettings();
    const validatedSettings = validateArray(timePeriodSettingsSchema, settings);
    const generatedPeriods = await generateTimePeriods(validatedSettings, startDate, endDate);

    // Check for overlapping periods before saving
    for (const period of generatedPeriods) {
      const overlappingPeriod = await TimePeriod.findOverlapping(period.start_date, period.end_date);
      if (overlappingPeriod) {
        throw new Error(`Cannot create time period: overlaps with existing period from ${overlappingPeriod.start_date} to ${overlappingPeriod.end_date}`);
      }
    }

    // Save generated periods to the database
    const savedPeriods = await Promise.all(generatedPeriods.map((period: ITimePeriod): Promise<ITimePeriod> => TimePeriod.create(period)));
    const validatedPeriods = validateArray(timePeriodSchema, savedPeriods);

    revalidatePath('/msp/time-entry');
    return validatedPeriods;
  } catch (error) {
    console.error('Error generating and saving time periods:', error);
    throw new Error('Failed to generate and save time periods');
  }
}
