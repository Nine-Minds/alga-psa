// @ts-nocheck
// TODO: This file needs refactoring - TimePeriod model method signatures have changed
'use server'

import { delegateToTimeSource } from '../lib/timeSource';
import { revalidatePath } from 'next/cache'
import { TimePeriod } from '../models/timePeriod'
import { TimePeriodSettings } from '../models/timePeriodSettings';
import type { ISO8601String } from '@alga-psa/types';
import {
  ITimePeriod,
  ITimePeriodView,
  ITimePeriodSettings
} from '@alga-psa/types';
import { ensureTimePeriodCoversDate } from '../lib/timePeriodMaterialization';
import { endOfConfiguredTimePeriod, yearBoundary } from '../lib/timePeriodCadence';
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
import { getSession, hasPermission, withAuth } from '@alga-psa/auth';
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

const CLOSED_TIME_PERIOD_MESSAGE = 'Time period is closed; reopen it first';

function timePeriodActionErrorMessage(error: unknown, fallback: string): string {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : '';

  if (message === 'Time period not found') {
    return 'Time period not found';
  }

  if (
    message === CLOSED_TIME_PERIOD_MESSAGE ||
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

  if (message === CLOSED_TIME_PERIOD_MESSAGE) {
    return actionError(message, 'msp/time-entry:errors.timePeriod.closed');
  }

  return actionError(message);
}

// Time periods are tenant-wide (they bound everyone's time sheets), so reading and
// changing them is reserved for roles holding the `time_period` permission. The
// time-entry flow itself stays ungated — getCurrentTimePeriod and
// getTimeEntryUserTimeZone must keep working for a technician filling a time sheet.
const TIME_PERIOD_PERMISSION_MESSAGES: Record<'read' | 'create' | 'update' | 'delete', string> = {
  read: 'Permission denied: cannot view time periods.',
  create: 'Permission denied: cannot create time periods.',
  update: 'Permission denied: cannot update time periods.',
  delete: 'Permission denied: cannot delete time periods.',
};

async function timePeriodPermissionError(
  user: Parameters<typeof hasPermission>[0],
  action: 'read' | 'create' | 'update' | 'delete',
  knex: Knex | Knex.Transaction
): Promise<ActionPermissionError | null> {
  if (await hasPermission(user, 'time_period', action, knex)) {
    return null;
  }
  return permissionError(
    TIME_PERIOD_PERMISSION_MESSAGES[action],
    `msp/time-entry:errors.timePeriod.permissions.${action}`
  );
}

export interface TimePeriodCapabilities {
  read: boolean;
  create: boolean;
  update: boolean;
  delete: boolean;
  /** Governs the time-period *settings* (the cadence rules), mirroring the v1 API. */
  manage: boolean;
}

/**
 * The viewer's `time_period` permissions, for gating the Settings > Time Entry controls.
 * The actions above remain the authoritative check; this only decides what to render.
 */
export const getTimePeriodCapabilities = withAuth(async (user): Promise<TimePeriodCapabilities> => {
  const { knex } = await createTenantKnex();
  const [read, create, update, remove, manage] = await Promise.all([
    hasPermission(user, 'time_period', 'read', knex),
    hasPermission(user, 'time_period', 'create', knex),
    hasPermission(user, 'time_period', 'update', knex),
    hasPermission(user, 'time_period', 'delete', knex),
    hasPermission(user, 'time_period', 'manage', knex),
  ]);

  return { read, create, update, delete: remove, manage };
});

export const getLatestTimePeriod = withAuth(async (user, { tenant }): Promise<TimePeriodActionResult<ITimePeriodView | null>> => {
  // Time-source seam: a registered non-native source may own this call; native falls through untouched (0 statements).
  const delegated = await delegateToTimeSource({ tenant, userId: user.user_id }, (source, ctx) => source.periods.readLatest(ctx));
  if (delegated.handled) return delegated.value;
  try {
    const { knex } = await createTenantKnex();
    const denied = await timePeriodPermissionError(user, 'read', knex);
    if (denied) {
      return denied;
    }

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
  // Time-source seam: a registered non-native source may own this call; native falls through untouched (0 statements).
  const delegated = await delegateToTimeSource({ tenant, userId: user.user_id }, (source, ctx) => source.periods.readSettings(ctx));
  if (delegated.handled) return delegated.value;
  try {
    const { knex } = await createTenantKnex();
    const denied = await timePeriodPermissionError(user, 'read', knex);
    if (denied) {
      return denied;
    }

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
  // Time-source seam: a registered non-native source may own this call; native falls through untouched (0 statements).
  const delegated = await delegateToTimeSource({ tenant, userId: user.user_id }, (source, ctx) => source.periods.create(ctx, input));
  if (delegated.handled) return delegated.value;
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
  const denied = await timePeriodPermissionError(user, 'create', db);
  if (denied) {
    return denied;
  }

  try {
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
  // Time-source seam: a registered non-native source may own this call; native falls through untouched (0 statements).
  const delegated = await delegateToTimeSource({ tenant, userId: user.user_id }, (source, ctx) => source.periods.read(ctx));
  if (delegated.handled) return delegated.value;
  try {
    console.log('Fetching all time periods...');

    const { knex } = await createTenantKnex();
    const denied = await timePeriodPermissionError(user, 'read', knex);
    if (denied) {
      return denied;
    }

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
  // Time-source seam: a registered non-native source may own this call; native falls through untouched (0 statements).
  const delegated = await delegateToTimeSource({ tenant, userId: user.user_id }, (source, ctx) => source.periods.readCurrent(ctx));
  if (delegated.handled) return delegated.value;
  try {
    const { knex } = await createTenantKnex();

    const userId = user?.user_id || null;
    const userTimeZone = tenant && userId ? await resolveUserTimeZone(knex, tenant, userId) : 'UTC';

    const currentDate = getCurrentDate(userTimeZone).toString();
    let currentPeriod = await TimePeriod.findByDate(knex, tenant, currentDate);
    if (!currentPeriod) {
      // Materialize the current period from the tenant's settings (no-op without settings).
      await ensureTimePeriodCoversDate(knex, tenant, Temporal.PlainDate.from(currentDate));
      currentPeriod = await TimePeriod.findByDate(knex, tenant, currentDate);
    }
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

export const getTimeEntryUserTimeZone = withAuth(async (user, { tenant }): Promise<TimePeriodActionResult<string>> => {
  try {
    const { knex } = await createTenantKnex();
    const userId = user?.user_id || null;
    if (!tenant || !userId) {
      return 'UTC';
    }
    return await resolveUserTimeZone(knex, tenant, userId);
  } catch (error) {
    const expected = timePeriodActionErrorFrom(error);
    if (expected) {
      return expected;
    }
    console.error('Error resolving time entry user timezone:', error);
    throw error;
  }
});

// Helper function to get the end of a period based on frequency unit
// LEVERAGE: pattern period-end-calc — one setting→[start,end) engine should own this
// The generator and the suggester read a setting through the same cadence function, so a
// monthly end_day is the last included day and a yearly profile ends at end_month /
// end_day_of_month, on both paths.
function getEndOfPeriod(startDate: string, setting: ITimePeriodSettings): Temporal.PlainDate {
  return endOfConfiguredTimePeriod(Temporal.PlainDate.from(startDate), setting);
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
      // start_day defaults to the 1st, as in timePeriodCadence and the suggester.
      const next = currentStart.with({ day: 1 }).add({ months: frequency });
      return next.with({ day: Math.min(setting.start_day || 1, next.daysInMonth) });
    }

    case 'year':
      return yearBoundary(setting, currentStart.year + frequency);

    default:
      return currentStart.add({ days: frequency });
  }
}

// Modify the generateTimePeriods function
// LEVERAGE: pattern period-grid — re-express through periodContaining/cellEnd once the item-3 end-day convention settles
export async function generateTimePeriods(
  settings: ITimePeriodSettings[],
  startDateStr: ISO8601String,
  endDateStr: ISO8601String
): Promise<ITimePeriodView[]> {
  const periods: ITimePeriodView[] = [];
  const startDate = toPlainDate(startDateStr);
  const endDate = toPlainDate(endDateStr);

  for (const setting of settings) {
    if (setting.is_active === false) continue;
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

    // Yearly profiles start on start_month / start_day_of_month, not on the range start.
    if (setting.frequency_unit === 'year') {
      let aligned = yearBoundary(setting, currentDate.year);
      if (Temporal.PlainDate.compare(aligned, currentDate) < 0) aligned = yearBoundary(setting, currentDate.year + 1);
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

      // Stored ends are exclusive, so a period whose end equals the range end (or effective_to)
      // still fits inside it.
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

      // The next period starts at the setting's next start (start_day / start_month), never at
      // this period's end: a 16th-to-month-end profile restarts on the 16th, a seasonal yearly
      // profile on its start_month. For day and week cadences the two coincide. (Walking to
      // periodEndDate for a fixed end_day once recomputed the same end forever.)
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
// LEVERAGE: pattern period-grid — forward-aligning grid; the suggester's periodContaining/cellEnd (lib/timePeriodSuggester.ts) is the second one
function alignToWeekday(dateStr: string, targetDay: number): string {
  const date = Temporal.PlainDate.from(dateStr);
  const daysToAdd = (targetDay - date.dayOfWeek + 7) % 7;
  return date.add({ days: daysToAdd }).toString();
}

// Helper function to align date to the specified day of the month
// LEVERAGE: pattern period-grid — forward-aligning grid; see alignToWeekday
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
  // Time-source seam: a registered non-native source may own this call; native falls through untouched (0 statements).
  const delegated = await delegateToTimeSource({ tenant, userId: user.user_id }, (source, ctx) => source.periods.remove(ctx, periodId));
  if (delegated.handled) return delegated.value;
  try {
    const { knex } = await createTenantKnex();
    const denied = await timePeriodPermissionError(user, 'delete', knex);
    if (denied) {
      return denied;
    }

    // Check if period exists and has no associated time records
    const period = await TimePeriod.findById(knex, tenant, periodId);
    if (!period) {
      throw new Error('Time period not found');
    }

    if (period.is_closed) {
      throw new Error(CLOSED_TIME_PERIOD_MESSAGE);
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
 * is tenant-wide, this is restricted to team managers (or to roles granted
 * `time_period:delete`, which is the admin-side route into the same removal). Removal is
 * per-id and isolated, so a blocked period only fails itself (reported in `failed`) without
 * aborting the batch.
 */
export const deleteTimePeriods = withAuth(async (
  user,
  { tenant },
  periodIds: string[]
): Promise<{ deletedIds: string[]; failed: Array<{ periodId: string; message: string }> }> => {
  // Time-source seam: a registered non-native source may own this call; native falls through untouched (0 statements).
  const delegated = await delegateToTimeSource({ tenant, userId: user.user_id }, (source, ctx) => source.periods.removeMany(ctx, periodIds));
  if (delegated.handled) return delegated.value;
  const { knex } = await createTenantKnex();

  // Manager gate: mirrors how the Time Entry page derives isManager (manages any team).
  const managedTeam = await tenantDb(knex, tenant).table('teams')
    .where({ manager_id: user.user_id })
    .first('team_id');
  const isManager = !!managedTeam;
  const canDelete = isManager || await hasPermission(user, 'time_period', 'delete', knex);

  const uniqueIds = Array.from(
    new Set((periodIds ?? []).filter((id) => typeof id === 'string' && id.length > 0))
  );

  const deletedIds: string[] = [];
  const failed: Array<{ periodId: string; message: string }> = [];

  if (!canDelete) {
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

      if (period.is_closed) {
        throw new Error(CLOSED_TIME_PERIOD_MESSAGE);
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
  // Time-source seam: a registered non-native source may own this call; native falls through untouched (0 statements).
  const delegated = await delegateToTimeSource({ tenant, userId: user.user_id }, (source, ctx) => source.periods.update(ctx, periodId, input));
  if (delegated.handled) return delegated.value;
  // Convert string dates to Temporal.PlainDate (Next.js server actions can't receive Temporal objects)
  const updates: Partial<Omit<ITimePeriod, 'period_id' | 'tenant'>> = {};
  try {
    if (input.start_date) updates.start_date = toPlainDate(input.start_date);
    if (input.end_date) updates.end_date = toPlainDate(input.end_date);
  } catch {
    return actionError('Enter valid start and end dates.', 'msp/time-entry:errors.timePeriod.datesRequired');
  }

  const { knex: db } = await createTenantKnex();
  const denied = await timePeriodPermissionError(user, 'update', db);
  if (denied) {
    return denied;
  }

  try {
    return await withTransaction(db, async (trx: Knex.Transaction) => {
    try {
      // Check if period exists and has no associated time records
      const period = await TimePeriod.findById(trx, tenant, periodId);
      if (!period) {
        throw new Error('Time period not found');
      }

      if (period.is_closed) {
        throw new Error(CLOSED_TIME_PERIOD_MESSAGE);
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
  // Time-source seam: a registered non-native source may own this call; native falls through untouched (0 statements).
  const delegated = await delegateToTimeSource({ tenant, userId: user.user_id }, (source, ctx) => source.periods.generate(ctx, startDate, endDate));
  if (delegated.handled) return delegated.value;
  const { knex: db } = await createTenantKnex();
  const denied = await timePeriodPermissionError(user, 'create', db);
  if (denied) {
    return denied;
  }

  return withTransaction(db, async (trx: Knex.Transaction) => {
    try {
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
