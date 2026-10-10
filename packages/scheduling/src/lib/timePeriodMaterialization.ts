/**
 * Creates time periods from a tenant's time period settings.
 *
 * Deliberately NOT in a 'use server' module: these helpers take a Knex handle and an explicit
 * tenant, so they must never be reachable as client-callable server actions.
 */
import { Temporal } from '@js-temporal/polyfill';
import type { Knex } from 'knex';
import type { ITimePeriod, ITimePeriodSettings, ITimePeriodView } from '@alga-psa/types';
import logger from '@alga-psa/core/logger';
import { toPlainDate } from '@alga-psa/core';
import { validateData, validateArray } from '@alga-psa/validation';
import { withTransaction } from '@alga-psa/db';
import { TimePeriod } from '../models/timePeriod';
import { TimePeriodSettings } from '../models/timePeriodSettings';
import { timePeriodSchema } from '../schemas/timeSheet.schemas';
import { TimePeriodSuggester } from './timePeriodSuggester';

// Safety limit to prevent infinite loops (max 1 year of weekly periods)
const MAX_PERIODS_PER_RUN = 52;

// Type for periods with Temporal.PlainDate (not string)
interface ITimePeriodWithPlainDate extends Omit<ITimePeriod, 'start_date' | 'end_date'> {
  start_date: Temporal.PlainDate;
  end_date: Temporal.PlainDate;
}

async function fetchAllTimePeriodsWithTrx(trx: Knex | Knex.Transaction, tenant: string): Promise<ITimePeriodView[]> {
  const timePeriods = await TimePeriod.getAll(trx, tenant);

  // Validate and convert to view type
  const validatedPeriods = validateArray(timePeriodSchema, timePeriods);
  return validatedPeriods.map((period): ITimePeriodView => ({
    ...period,
    start_date: period.start_date.toString(),
    end_date: period.end_date.toString()
  }));
}

async function createTimePeriodWithTrx(
  trx: Knex | Knex.Transaction,
  tenant: string,
  timePeriodData: Omit<ITimePeriod, 'period_id' | 'tenant'>
): Promise<ITimePeriod> {
  // Check for overlapping periods
  const overlappingPeriod = await TimePeriod.findOverlapping(trx, tenant, timePeriodData.start_date, timePeriodData.end_date);
  if (overlappingPeriod) {
    throw new Error('Cannot create time period: overlaps with existing period');
  }

  const timePeriod = await TimePeriod.create(trx, tenant, timePeriodData);
  return validateData(timePeriodSchema, timePeriod);
}

function toModelPeriodsWithPlainDate(periods: ITimePeriodView[]): ITimePeriodWithPlainDate[] {
  return periods.map(period => ({
    ...period,
    start_date: toPlainDate(period.start_date),
    end_date: toPlainDate(period.end_date)
  }));
}

/**
 * Creates time periods from the settings, starting with the current period when none exist and
 * then filling forward while each suggested start is within `daysThreshold` days of `today`.
 * Must run inside a transaction; takes the per-tenant time-period advisory lock so the nightly job
 * and on-demand creation cannot interleave. Returns the last period created, or null.
 */
export async function createTimePeriodsThrough(
  trx: Knex.Transaction,
  tenant: string,
  settings: ITimePeriodSettings[],
  today: Temporal.PlainDate,
  daysThreshold: number
): Promise<ITimePeriod | null> {
  await trx.raw('SELECT pg_advisory_xact_lock(hashtext(?))', [`time-periods:${tenant}`]);

  const createdPeriods: ITimePeriod[] = [];

  // Read after taking the lock, so a concurrent creator's periods are visible.
  const existingPeriods = await fetchAllTimePeriodsWithTrx(trx, tenant);
  // Keep model periods in memory to avoid repeated DB queries
  const modelPeriods: ITimePeriodWithPlainDate[] = toModelPeriodsWithPlainDate(existingPeriods);

  // Days from today to a period start. Positive = future, negative = past (gap that needs filling).
  const daysFromToday = (start: Temporal.PlainDate): number => start.since(today, { largestUnit: 'day' }).days;

  if (modelPeriods.length === 0) {
    logger.info('No existing time periods found. Creating initial time period based on settings.');
    logger.debug('Available settings:', { settings: settings.map(s => ({
      start_day: s.start_day,
      end_day: s.end_day,
      frequency_unit: s.frequency_unit
    }))});
  }

  // Bootstrap (when no periods exist) and gap-fill share one loop: suggest first, then apply the
  // threshold to the *suggested start*, because a gap-skip can move the start forward. The bootstrap
  // suggestion is the current period, whose start is <= today, so it always passes; a future
  // effective_from waits until it is inside the threshold.
  for (let i = 0; i < MAX_PERIODS_PER_RUN; i++) {
    const suggestion = TimePeriodSuggester.suggestNewTimePeriod(settings, modelPeriods, { today });

    if (!suggestion.success || !suggestion.data) {
      // "No applicable settings" is not an error - it means no period should be created
      logger.info(`No time period to create: ${suggestion.error || 'Unknown reason'}`);
      break;
    }

    const newStart = toPlainDate(suggestion.data.start_date);
    const days = daysFromToday(newStart);
    if (days > daysThreshold) {
      if (createdPeriods.length === 0) {
        logger.debug(`Not creating new period: next start date is ${days} days from today (threshold: ${daysThreshold})`);
      } else {
        logger.info(`Stopped after creating ${createdPeriods.length} period(s). Next start date is ${days} days from today (threshold: ${daysThreshold})`);
      }
      break;
    }

    const newPeriod = await createTimePeriodWithTrx(trx, tenant, {
      start_date: newStart,
      end_date: toPlainDate(suggestion.data.end_date)
    });

    createdPeriods.push(newPeriod);
    modelPeriods.push({
      ...newPeriod,
      start_date: toPlainDate(newPeriod.start_date),
      end_date: toPlainDate(newPeriod.end_date)
    });

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
}

/**
 * Makes sure a time period covers `date` when the tenant has active settings. Safe to call from
 * read paths: cheap when a period exists, a no-op without settings, and failures are logged and
 * swallowed so a read never breaks. Callers must only pass today's date (never historical dates).
 */
export async function ensureTimePeriodCoversDate(
  knex: Knex,
  tenant: string,
  date: Temporal.PlainDate
): Promise<void> {
  try {
    const existing = await TimePeriod.findByDate(knex, tenant, date.toString());
    if (existing) return;

    const settings = await TimePeriodSettings.getActiveSettings(knex, tenant);
    if (!settings.length) return;

    await withTransaction(knex, (trx) => createTimePeriodsThrough(trx, tenant, settings, date, 0));
  } catch (error) {
    logger.error(`Failed to ensure a time period covers ${date.toString()} for tenant ${tenant}:`, error);
  }
}
