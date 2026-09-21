// @ts-nocheck
// TODO: This file needs refactoring - TimePeriod model method signatures have changed
'use server'

import { revalidatePath } from 'next/cache'
import { TimePeriod } from '../models/timePeriod'
import { readCoManagedNativeTimePeriodSettings, readCoManagedNativeTimePeriods, commandCoManagedNativeTimePeriods, listCoManagedNativeTimeSheets, CoManagedSharedWorkError } from '@alga-psa/co-managed';
import { TimePeriodCalendarError } from '@alga-psa/db';
import { resolveNativeTimeBrowserActor } from '../lib/nativeTimeReader';
import { TimePeriodSettings } from '../models/timePeriodSettings';
import type { ISO8601String } from '@alga-psa/types';
import {
  ITimePeriod,
  ITimePeriodView,
  ITimePeriodSettings
} from '@alga-psa/types';
import { endOfConfiguredTimePeriod } from '../lib/timePeriodCadence';
import { addDays, addMonths, format, differenceInHours, parseISO, startOfDay, formatISO, endOfMonth, AddMonthsOptions, differenceInDays } from 'date-fns';
import { fromZonedTime, toZonedTime } from 'date-fns-tz';
import { validateData, validateArray } from '@alga-psa/validation';
import { timePeriodSchema, timePeriodSettingsSchema } from '../schemas/timeSheet.schemas';
import { formatUtcDateNoTime, toPlainDate } from '@alga-psa/core';
import { parse } from 'path';
import { Temporal } from '@js-temporal/polyfill';
import { createTenantKnex, tenantDb, withTransaction } from '@alga-psa/db';
import { Knex } from 'knex';
import logger from '@alga-psa/core/logger';
import { getSession, withAuth } from '@alga-psa/auth';
import { resolveUserTimeZone } from '@alga-psa/db';
import { v4 as uuidv4 } from 'uuid';
import {
  actionError,
  isActionMessageError,
  isActionPermissionError,
  permissionError,
  type ActionMessageError,
  type ActionPermissionError,
} from '@alga-psa/ui/lib/errorHandling';

// Special value to indicate end of period
const END_OF_PERIOD = 0;

// These actions are also driven from background jobs and from the billing
// bootstrap, where there is no Next.js request context and revalidatePath
// throws "Invariant: static generation store missing". Cache invalidation is
// best-effort, so it must never fail the period write that just committed.
function safeRevalidate(path: string): void {
  try {
    revalidatePath(path);
  } catch (error) {
    logger.warn(`[timePeriodsActions] Failed to revalidate path "${path}":`, error instanceof Error ? error.message : error);
  }
}

// Input type for server actions - accepts string dates (Next.js can't serialize Temporal.PlainDate)
interface TimePeriodInput {
  start_date: string;
  end_date: string;
}

export type TimePeriodActionError = ActionMessageError | ActionPermissionError;
export type TimePeriodActionResult<T> = T | TimePeriodActionError;

const serializeDateOnly = (value: unknown): string => {
  if (typeof value === 'string') {
    return value;
  }

  if (value && typeof (value as { toString?: () => string }).toString === 'function') {
    return (value as { toString: () => string }).toString();
  }

  return String(value ?? '');
};

const toTimePeriodView = (period: ITimePeriod): ITimePeriodView => ({
  ...period,
  start_date: serializeDateOnly(period.start_date),
  end_date: serializeDateOnly(period.end_date),
});

function timePeriodActionErrorMessage(error: unknown, fallback: string): string {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : '';

  if (message === 'Time period not found') {
    return 'Time period not found';
  }

  if (
    message === 'Cannot delete time period with associated time sheets' ||
    message === 'Cannot remove a period that has timesheets' ||
    message === 'Cannot remove the current period' ||
    message === 'Cannot update time period with associated time sheets' ||
    message === 'Cannot update time period: overlaps with existing period' ||
    message === 'Cannot create time period: overlaps with existing period' ||
    message.startsWith('Cannot create time period: overlaps with existing period from ')
  ) {
    return message;
  }

  if (message.startsWith('Access denied:')) {
    return message;
  }

  return fallback;
}

function timePeriodActionErrorFrom(error: unknown, fallback = ''): TimePeriodActionError | null {
  if (isActionMessageError(error) || isActionPermissionError(error)) {
    return error;
  }

  const message = timePeriodActionErrorMessage(error, fallback);
  if (!message) {
    return null;
  }

  if (message.startsWith('Access denied:')) {
    return permissionError(message);
  }

  return actionError(message);
}

export const getLatestTimePeriod = withAuth(async (user, { tenant }): Promise<TimePeriodActionResult<ITimePeriodView | null>> => {
  try {
    const { knex } = await createTenantKnex();
    const current = await readCoManagedNativeTimePeriods(knex, tenant, () => resolveNativeTimeBrowserActor(user, tenant), { latest: true });
    if (current.handled) return current.periods[0] ?? null;
    const latestPeriod = await TimePeriod.getLatest(knex, tenant);
    if (!latestPeriod) {
      return null;
    }

    const validatedPeriod = validateData(timePeriodSchema, latestPeriod);
    return toTimePeriodView(validatedPeriod);
  } catch (error) {
    const expected = timePeriodActionErrorFrom(error);
    if (expected) {
      return expected;
    }
    console.error('Error fetching latest time period:', error);
    throw error;
  }
});

export const getTimePeriodSettings = withAuth(async (user, { tenant }): Promise<TimePeriodActionResult<ITimePeriodSettings[]>> => {
  try {
    const { knex } = await createTenantKnex();
    const current = await readCoManagedNativeTimePeriodSettings(knex, tenant, () => resolveNativeTimeBrowserActor(user, tenant), { activeOnly: true });
    if (current.handled) return current.settings;

    const settings = await TimePeriodSettings.getActiveSettings(knex, tenant);
    return validateArray(timePeriodSettingsSchema, settings);
  } catch (error) {
    const expected = timePeriodActionErrorFrom(error);
    if (expected) {
      return expected;
    }
    console.error('Error fetching time period settings:', error);
    throw error;
  }
});

export const createTimePeriod = withAuth(async (
  user,
  { tenant },
  input: TimePeriodInput
): Promise<TimePeriodActionResult<ITimePeriodView>> => {
  // Convert string dates to Temporal.PlainDate (Next.js server actions can't receive Temporal objects)
  let timePeriodData: { start_date: Temporal.PlainDate; end_date: Temporal.PlainDate };
  try {
    timePeriodData = {
      start_date: toPlainDate(input.start_date),
      end_date: toPlainDate(input.end_date)
    };
  } catch {
    return actionError('Enter valid start and end dates.', 'msp/time-entry:errors.timePeriod.datesRequired');
  }

  const { knex: db } = await createTenantKnex();
  try {
    const current = await commandCoManagedNativeTimePeriods(db, tenant, { action: 'create', periods: [input] }, () => resolveNativeTimeBrowserActor(user, tenant));
    if (current.handled) { safeRevalidate('/msp/time-entry'); return current.periods[0]; }
    return await withTransaction(db, async (trx: Knex.Transaction) => {
    try {
      const settings = await TimePeriodSettings.getActiveSettings(trx, tenant);
      const validatedSettings = validateArray(timePeriodSettingsSchema, settings);

      // Check for overlapping periods
      const overlappingPeriod = await TimePeriod.findOverlapping(trx, tenant, timePeriodData.start_date, timePeriodData.end_date);
      if (overlappingPeriod) {
        throw new Error('Cannot create time period: overlaps with existing period');
      }

      const timePeriod = await TimePeriod.create(trx, tenant, timePeriodData);
      const validatedPeriod = validateData(timePeriodSchema, timePeriod);

      safeRevalidate('/msp/time-entry');

      return toTimePeriodView(validatedPeriod);
    } catch (error) {
      console.error('Error in createTimePeriod function:', error);
      throw error;
    }
    });
  } catch (error) {
    const expected = timePeriodActionErrorFrom(error);
    if (expected) {
      return expected;
    }
    console.error('Error creating time period:', error);
    throw error;
  }
});

export const fetchAllTimePeriods = withAuth(async (user, { tenant }): Promise<TimePeriodActionResult<ITimePeriodView[]>> => {
  try {
    console.log('Fetching all time periods...');

    const { knex } = await createTenantKnex();
    const current = await readCoManagedNativeTimePeriods(knex, tenant, () => resolveNativeTimeBrowserActor(user, tenant));
    if (current.handled) return current.periods;
    const timePeriods = await TimePeriod.getAll(knex, tenant);

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
    const expected = timePeriodActionErrorFrom(error);
    if (expected) {
      return expected;
    }
    console.error('Error fetching all time periods:', error);
    throw error;
  }
});

// Utility function to get current date as Temporal.PlainDate
function getCurrentDate(timeZone: string): Temporal.PlainDate {
  return Temporal.Now.plainDateISO(timeZone);
}

export const getCurrentTimePeriod = withAuth(async (user, { tenant }): Promise<TimePeriodActionResult<ITimePeriodView | null>> => {
  try {
    const { knex } = await createTenantKnex();

    const userId = user?.user_id || null;
    const userTimeZone = tenant && userId ? await resolveUserTimeZone(knex, tenant, userId) : 'UTC';

    const currentDate = getCurrentDate(userTimeZone).toString();
    const current = await listCoManagedNativeTimeSheets(knex, tenant, () => resolveNativeTimeBrowserActor(user, tenant), { userId: user.user_id, periods: true });
    if (current.handled) {
      const period = current.periods.find(period => period.start_date <= currentDate && period.end_date > currentDate);
      return period ? { tenant, period_id: period.period_id, start_date: period.start_date, end_date: period.end_date } : null;
    }

    const currentPeriod = await TimePeriod.findByDate(knex, tenant, currentDate);
    if (!currentPeriod) return null;

    // Convert Temporal.PlainDate to string for view type
    return {
      ...currentPeriod,
      start_date: currentPeriod.start_date.toString(),
      end_date: currentPeriod.end_date.toString()
    };
  } catch (error) {
    const expected = timePeriodActionErrorFrom(error);
    if (expected) {
      return expected;
    }
    console.error('Error fetching current time period:', error);
    throw error;
  }
});

// Helper function to get the end of a period based on frequency unit
function getEndOfPeriod(startDate: string, setting: ITimePeriodSettings): Temporal.PlainDate {
  return endOfConfiguredTimePeriod(toPlainDate(startDate), setting);
}

// Start of the period that follows the one beginning at currentStart, for
// settings whose end day is fixed rather than the end of the period.
function getNextPeriodStart(
  currentStart: Temporal.PlainDate,
  setting: ITimePeriodSettings
): Temporal.PlainDate {
  const frequency = setting.frequency || 1;

  switch (setting.frequency_unit) {
    case 'week':
      return currentStart.add({ days: 7 * frequency });

    case 'month': {
      const next = currentStart.add({ months: frequency });
      return setting.start_day
        ? next.with({ day: Math.min(setting.start_day, next.daysInMonth) })
        : next;
    }

    case 'year': {
      const next = currentStart.add({ years: frequency }).with({ month: setting.start_month ?? currentStart.month, day: 1 });
      return next.with({ day: Math.min(setting.start_day_of_month ?? currentStart.day, next.daysInMonth) });
    }

    default:
      return currentStart.add({ days: frequency });
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
    if (!setting.is_active) continue;
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

    if (setting.frequency_unit === 'year') {
      let aligned = currentDate.with({ month: setting.start_month ?? 1, day: 1 });
      aligned = aligned.with({ day: Math.min(setting.start_day_of_month ?? 1, aligned.daysInMonth) });
      if (Temporal.PlainDate.compare(aligned, currentDate) < 0) aligned = aligned.add({ years: 1 });
      currentDate = aligned;
    }

    while (Temporal.PlainDate.compare(currentDate, endDate) < 0) {
      if (setting.effective_to) {
        const effectiveTo = toPlainDate(setting.effective_to);
        if (Temporal.PlainDate.compare(currentDate, effectiveTo) > 0) {
          break;
        }
      }

      const periodEndDate = getEndOfPeriod(currentDate.toString(), setting);

      if (Temporal.PlainDate.compare(periodEndDate, endDate) > 0) {
        break;
      }

      if (setting.effective_to) {
        const effectiveTo = toPlainDate(setting.effective_to);
        if (Temporal.PlainDate.compare(periodEndDate, effectiveTo) > 0) {
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

      // Each profile advances to its next configured start. A partial-month
      // or seasonal profile must not expand into the next profile's range.
      const nextDate = getNextPeriodStart(currentDate, setting);

      if (Temporal.PlainDate.compare(nextDate, currentDate) <= 0) {
        break;
      }

      currentDate = nextDate;
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

export const deleteTimePeriod = withAuth(async (user, { tenant }, periodId: string): Promise<TimePeriodActionResult<void>> => {
  try {
    const { knex } = await createTenantKnex();
    const current = await commandCoManagedNativeTimePeriods(knex, tenant, { action: 'delete', id: periodId }, () => resolveNativeTimeBrowserActor(user, tenant));
    if (current.handled) { safeRevalidate('/msp/time-entry'); return; }
    // Check if period exists and has no associated time records
    const period = await TimePeriod.findById(knex, tenant, periodId);
    if (!period) {
      throw new Error('Time period not found');
    }

    const isEditable = await TimePeriod.isEditable(knex, tenant, periodId);
    if (!isEditable) {
      throw new Error('Cannot delete time period with associated time sheets');
    }

    try {
      await TimePeriod.delete(knex, tenant, periodId);
      safeRevalidate('/msp/time-entry');
    } catch (error: any) {
      if (error.message.includes('belongs to different tenant')) {
        throw new Error('Access denied: Cannot delete time period');
      }
      console.error('Error deleting time period:', error);
      throw error;
    }
  } catch (error) {
    const expected = timePeriodActionErrorFrom(error);
    if (expected) {
      return expected;
    }
    console.error('Error in deleteTimePeriod:', error);
    throw error;
  }
});

/**
 * Remove unused/unneeded time periods directly from the Time Entry list. A period is only
 * removable when it is completely unused: no timesheets exist for it (for any user, which
 * also implies no time entries) and it is not the current period. Because deleting a period
 * is tenant-wide, this is restricted to team managers. Removal is per-id and isolated, so a
 * blocked period only fails itself (reported in `failed`) without aborting the batch.
 */
export const deleteTimePeriods = withAuth(async (
  user,
  { tenant },
  periodIds: string[]
): Promise<{ deletedIds: string[]; failed: Array<{ periodId: string; message: string }> }> => {
  const { knex } = await createTenantKnex();
  const customerResult = { deletedIds: [] as string[], failed: [] as Array<{ periodId: string; message: string }> };
  let customerHandled = false;
  for (const periodId of [...new Set(periodIds ?? [])]) {
    try {
      const current = await commandCoManagedNativeTimePeriods(knex, tenant, { action: 'delete', id: periodId, preserveDate: new Date().toISOString().slice(0, 10) }, () => resolveNativeTimeBrowserActor(user, tenant));
      if (!current.handled) break;
      customerHandled = true; customerResult.deletedIds.push(periodId);
    } catch (error) {
      if (!(error instanceof CoManagedSharedWorkError) && !(error instanceof TimePeriodCalendarError)) throw error;
      customerHandled = true;
      customerResult.failed.push({ periodId, message: error instanceof CoManagedSharedWorkError ? 'Access denied: Cannot remove time period' : error.message });
    }
  }
  if (customerHandled) { if (customerResult.deletedIds.length) safeRevalidate('/msp/time-entry'); return customerResult; }


  // Manager gate: mirrors how the Time Entry page derives isManager (manages any team).
  const managedTeam = await tenantDb(knex, tenant).table('teams')
    .where({ manager_id: user.user_id })
    .first('team_id');
  const isManager = !!managedTeam;

  const uniqueIds = Array.from(
    new Set((periodIds ?? []).filter((id) => typeof id === 'string' && id.length > 0))
  );

  const deletedIds: string[] = [];
  const failed: Array<{ periodId: string; message: string }> = [];

  if (!isManager) {
    for (const periodId of uniqueIds) {
      failed.push({ periodId, message: 'Only managers can remove time periods' });
    }
    return { deletedIds, failed };
  }

  const today = formatISO(new Date(), { representation: 'date' });

  for (const periodId of uniqueIds) {
    try {
      const period = await TimePeriod.findById(knex, tenant, periodId);
      if (!period) {
        throw new Error('Time period not found');
      }

      // Tenant-wide guard: refuse if any timesheet exists for the period.
      const editable = await TimePeriod.isEditable(knex, tenant, periodId);
      if (!editable) {
        throw new Error('Cannot remove a period that has timesheets');
      }

      // Never remove the active period (defense in depth; the UI also hides it).
      const start = toPlainDate(period.start_date).toString();
      const end = toPlainDate(period.end_date).toString();
      if (today >= start && today < end) {
        throw new Error('Cannot remove the current period');
      }

      await TimePeriod.delete(knex, tenant, periodId);
      deletedIds.push(periodId);
    } catch (error) {
      const expectedMessage = timePeriodActionErrorMessage(error, '');
      if (!expectedMessage) {
        throw error;
      }
      failed.push({
        periodId,
        message: expectedMessage
      });
    }
  }

  if (deletedIds.length > 0) {
    safeRevalidate('/msp/time-entry');
  }

  return { deletedIds, failed };
});

export const updateTimePeriod = withAuth(async (
  user,
  { tenant },
  periodId: string,
  input: Partial<TimePeriodInput>
): Promise<TimePeriodActionResult<ITimePeriodView>> => {
  // Convert string dates to Temporal.PlainDate (Next.js server actions can't receive Temporal objects)
  const updates: Partial<Omit<ITimePeriod, 'period_id' | 'tenant'>> = {};
  try {
    if (input.start_date) updates.start_date = toPlainDate(input.start_date);
    if (input.end_date) updates.end_date = toPlainDate(input.end_date);
  } catch {
    return actionError('Enter valid start and end dates.', 'msp/time-entry:errors.timePeriod.datesRequired');
  }

  const { knex: db } = await createTenantKnex();
  try {
    const current = await commandCoManagedNativeTimePeriods(db, tenant, { action: 'update', id: periodId, dates: input }, () => resolveNativeTimeBrowserActor(user, tenant));
    if (current.handled) { safeRevalidate('/msp/time-entry'); return current.periods[0]; }
    return await withTransaction(db, async (trx: Knex.Transaction) => {
    try {
      // Check if period exists and has no associated time records
      const period = await TimePeriod.findById(trx, tenant, periodId);
      if (!period) {
        throw new Error('Time period not found');
      }

      const isEditable = await TimePeriod.isEditable(trx, tenant, periodId);
      if (!isEditable) {
        throw new Error('Cannot update time period with associated time sheets');
      }

      // Check for overlapping periods
      if (updates.start_date || updates.end_date) {
        const startDate = updates.start_date || period.start_date;
        const endDate = updates.end_date || period.end_date;
        const overlappingPeriod = await TimePeriod.findOverlapping(trx, tenant, startDate, endDate, periodId);
        if (overlappingPeriod) {
          throw new Error('Cannot update time period: overlaps with existing period');
        }
      }

      try {
        const updatedPeriod = await TimePeriod.update(trx, tenant, periodId, updates);
        const validatedPeriod = validateData(timePeriodSchema, updatedPeriod);

        safeRevalidate('/msp/time-entry');
        return toTimePeriodView(validatedPeriod);
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
  } catch (error) {
    const expected = timePeriodActionErrorFrom(error);
    if (expected) {
      return expected;
    }
    console.error('Error updating time period:', error);
    throw error;
  }
});

export const generateAndSaveTimePeriods = withAuth(async (user, { tenant }, startDate: ISO8601String, endDate: ISO8601String): Promise<TimePeriodActionResult<ITimePeriodView[]>> => {
  const { knex: db } = await createTenantKnex();
  return withTransaction(db, async (trx: Knex.Transaction) => {
    try {
      const current = await commandCoManagedNativeTimePeriods(trx, tenant, { action: 'create', periods: async calendar => {
        const admitted = await readCoManagedNativeTimePeriodSettings(calendar, tenant, () => resolveNativeTimeBrowserActor(user, tenant), { activeOnly: true, complete: true });
        if (!admitted.handled) throw new CoManagedSharedWorkError();
        return generateTimePeriods(admitted.settings, startDate, endDate);
      } }, () => resolveNativeTimeBrowserActor(user, tenant));
      if (current.handled) { safeRevalidate('/msp/time-entry'); return current.periods; }

      const settings = await getTimePeriodSettings();
      if (isActionMessageError(settings) || isActionPermissionError(settings)) {
        return settings;
      }
      const validatedSettings = validateArray(timePeriodSettingsSchema, settings);
      const generatedPeriods = await generateTimePeriods(validatedSettings, startDate, endDate);

      // Check for overlapping periods before saving
      for (const period of generatedPeriods) {
        const overlappingPeriod = await TimePeriod.findOverlapping(
          trx,
          tenant,
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
        return TimePeriod.create(trx, tenant, {
          ...period,
          start_date: toPlainDate(period.start_date),
          end_date: toPlainDate(period.end_date)
        });
      }));
      const validatedPeriods = validateArray(timePeriodSchema, savedPeriods);

      safeRevalidate('/msp/time-entry');
      return validatedPeriods.map((period): ITimePeriodView => toTimePeriodView(period));
    } catch (error) {
      const expected = timePeriodActionErrorFrom(error);
      if (expected) {
        return expected;
      }
      console.error('Error generating and saving time periods:', error);
      throw error;
    }
  });
});
