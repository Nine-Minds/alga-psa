import { format, toZonedTime } from 'date-fns-tz';
import { formatISO, getDaysInMonth } from 'date-fns';
import type { Knex } from 'knex';
import { Temporal } from '@js-temporal/polyfill';
import type { ISO8601String, ITimePeriodSettings } from '@alga-psa/types';
import { formatUtcDateNoTime } from '@alga-psa/core';
import { resolveUserTimeZone, tenantDb, withTransaction } from '@alga-psa/db';
import { clampDefaultPastEndedSettings, defaultEffectiveFrom } from '../lib/timePeriodSuggester';

// Special value to indicate end of period
const END_OF_PERIOD = 0;

/**
 * A time period setting broke a business rule. `kind` lets each caller pick its own response:
 * the server action returns the message, the REST API maps invalid/overlap/not_found to 400/409/404.
 */
export type TimePeriodSettingsRuleErrorKind = 'invalid' | 'overlap' | 'not_found';

export class TimePeriodSettingsRuleError extends Error {
  constructor(public readonly kind: TimePeriodSettingsRuleErrorKind, message: string) {
    super(message);
    this.name = 'TimePeriodSettingsRuleError';
  }
}

/** Fields a caller may set on a time period setting. Dates are calendar dates (YYYY-MM-DD or ISO). */
export type TimePeriodSettingsFields = Pick<ITimePeriodSettings, 'frequency' | 'frequency_unit'> &
  Partial<Pick<ITimePeriodSettings,
    'start_day' | 'end_day' | 'start_month' | 'start_day_of_month' | 'end_month' | 'end_day_of_month'
  >> & {
    effective_from?: string | null;
    effective_to?: string | null;
  };

/** A patch for update: every field optional; `effective_to: null` clears the end date. */
export type TimePeriodSettingsPatch = Partial<TimePeriodSettingsFields> & { is_active?: boolean };

type TimePeriodSettingsRow = Omit<ITimePeriodSettings, 'effective_from' | 'effective_to' | 'created_at' | 'updated_at'> & {
  effective_from: string | Date;
  effective_to?: string | Date | null;
  created_at: string | Date;
  updated_at: string | Date;
};

/** A setting in normalized form: effective dates as midnight-UTC strings (formatUtcDateNoTime), ISO timestamps. */
type NormalizedSettings = Omit<ITimePeriodSettings, 'time_period_settings_id'> & { time_period_settings_id?: string };

const toDateOnly = (value: string | Date): string => formatUtcDateNoTime(new Date(value));

function settingsTable(conn: Knex | Knex.Transaction, tenant: string) {
  return tenantDb(conn, tenant).table<TimePeriodSettingsRow>('time_period_settings');
}

export class TimePeriodSettings {
  static async getActiveSettings(knexOrTrx: Knex | Knex.Transaction, tenant: string): Promise<ITimePeriodSettings[]> {
    try {
      const settings = await tenantDb(knexOrTrx, tenant).table<ITimePeriodSettings>('time_period_settings')
        .where('is_active', true)
        .orderBy('effective_from', 'desc');

      if (!settings.length) {
        console.warn(`No active time period settings found for tenant ${tenant}`);
      }

      return settings.map((setting): ITimePeriodSettings => ({
        ...setting,
        effective_from: this.toISO8601(setting.effective_from),
        effective_to: setting.effective_to ? this.toISO8601(setting.effective_to) : undefined,
        created_at: this.toISO8601(setting.created_at),
        updated_at: this.toISO8601(setting.updated_at),
      }));
    } catch (error) {
      console.error(`Error getting active time period settings: ${error instanceof Error ? error.message : 'Unknown error'}`);
      throw error;
    }
  }

  /** Every setting for the tenant (active or not), newest effective_from first, in normalized form. */
  static async list(knexOrTrx: Knex | Knex.Transaction, tenant: string): Promise<ITimePeriodSettings[]> {
    const rows = await settingsTable(knexOrTrx, tenant).orderBy('effective_from', 'desc');
    return rows.map((row) => this.normalizeRow(row));
  }

  static async getById(knexOrTrx: Knex | Knex.Transaction, tenant: string, id: string): Promise<ITimePeriodSettings> {
    const row = await settingsTable(knexOrTrx, tenant).where({ time_period_settings_id: id }).first();
    if (!row) {
      throw new TimePeriodSettingsRuleError('not_found', 'Time period settings not found');
    }
    return this.normalizeRow(row);
  }

  /**
   * Create an active setting. Without effective_from, it defaults to the start of the period containing
   * today in the creating user's timezone (UTC without a user), then hands off the day after any
   * conflicting setting that ended on or after that start. An explicit effective_from is never moved.
   * Overlaps are rejected with a TimePeriodSettingsRuleError('overlap').
   */
  static async create(
    knex: Knex,
    tenant: string,
    input: TimePeriodSettingsFields,
    options: { userId?: string | null } = {},
  ): Promise<ITimePeriodSettings> {
    const now = formatISO(new Date());
    const fields = {
      frequency: input.frequency,
      frequency_unit: input.frequency_unit,
      start_day: input.start_day || 1,
      end_day: input.end_day || END_OF_PERIOD,
      start_month: input.start_month || 1,
      start_day_of_month: input.start_day_of_month || 1,
      end_month: input.end_month || 12,
      end_day_of_month: input.end_day_of_month || END_OF_PERIOD,
    };

    let alignedDefault: Temporal.PlainDate | null = null;
    let effectiveFrom: string;
    if (input.effective_from) {
      effectiveFrom = toDateOnly(input.effective_from);
    } else {
      // Default: start of the period containing today in the creating user's timezone, so the
      // current period is fully covered and an evening save in the Americas isn't a day ahead.
      // If an earlier setting ended on or after that start, the new setting hands off the day after
      // it ended (see the clamp inside the transaction below); the default may then be in the future.
      const localToday = await resolveLocalToday(knex, tenant, options.userId ?? null);
      alignedDefault = defaultEffectiveFrom(fields as ITimePeriodSettings, localToday);
      effectiveFrom = alignedDefault.toString();
    }

    const newSettings: NormalizedSettings = {
      ...fields,
      is_active: true,
      effective_from: effectiveFrom,
      effective_to: input.effective_to ? toDateOnly(input.effective_to) : undefined,
      created_at: now,
      updated_at: now,
      tenant,
    };

    const inserted = await withTransaction(knex, async (trx: Knex.Transaction) => {
      if (alignedDefault) {
        // Read the conflicting ended settings in the same transaction as the validation below, with the
        // validator's filter (active rows) plus doPeriodsOverlap, so the clamp and the check see the same rows.
        // Open-ended settings are not clamped around; validation still rejects them.
        const endedRows = await settingsTable(trx, tenant)
          .where('is_active', true)
          .whereNotNull('effective_to')
          .andWhere('effective_to', '>=', new Date(alignedDefault.toString()));
        const conflicting = endedRows
          .filter((row) => doPeriodsOverlap(newSettings, row as unknown as ITimePeriodSettings))
          .map((row) => ({ effective_to: toDateOnly(row.effective_to as string | Date) }));
        newSettings.effective_from = clampDefaultPastEndedSettings(alignedDefault, conflicting).toString();
      }

      // Validate the business rules and check for overlaps before database insertion
      await validateTimePeriodSettings(newSettings, trx);

      const [row] = await settingsTable(trx, tenant)
        .insert({
          ...newSettings,
          effective_from: new Date(newSettings.effective_from),
          effective_to: newSettings.effective_to ? new Date(newSettings.effective_to) : null,
          created_at: new Date(newSettings.created_at),
          updated_at: new Date(newSettings.updated_at),
        })
        .returning('*');
      return row;
    });

    // NOTE: Recurring job scheduling is handled at a higher layer; avoid scheduling → jobs deps here.
    return this.normalizeRow(inserted);
  }

  /**
   * Apply a patch to an existing setting. The merged result is validated against the other active
   * settings exactly as a create is; effective dates are never adjusted.
   */
  static async update(
    knex: Knex,
    tenant: string,
    id: string,
    patch: TimePeriodSettingsPatch,
  ): Promise<ITimePeriodSettings> {
    return withTransaction(knex, async (trx: Knex.Transaction) => {
      const existing = await settingsTable(trx, tenant).where({ time_period_settings_id: id }).first();
      if (!existing) {
        throw new TimePeriodSettingsRuleError('not_found', 'Time period settings not found');
      }

      const current = this.normalizeRow(existing);
      const merged: NormalizedSettings = {
        ...current,
        ...definedFields(patch),
        effective_from: patch.effective_from ? toDateOnly(patch.effective_from) : current.effective_from,
        effective_to: patch.effective_to === null
          ? undefined
          : patch.effective_to ? toDateOnly(patch.effective_to) : current.effective_to,
        updated_at: formatISO(new Date()),
        tenant,
      };

      // Validate business rules and check for overlaps
      await validateTimePeriodSettings(merged, trx, id);

      const [row] = await settingsTable(trx, tenant)
        .where({ time_period_settings_id: id })
        .update({
          frequency: merged.frequency,
          frequency_unit: merged.frequency_unit,
          is_active: merged.is_active,
          effective_from: new Date(merged.effective_from),
          effective_to: merged.effective_to ? new Date(merged.effective_to) : null,
          start_day: merged.start_day,
          end_day: merged.end_day,
          start_month: merged.start_month,
          start_day_of_month: merged.start_day_of_month,
          end_month: merged.end_month,
          end_day_of_month: merged.end_day_of_month,
          updated_at: new Date(merged.updated_at),
        })
        .returning('*');
      if (!row) {
        throw new TimePeriodSettingsRuleError('not_found', 'Time period settings not found');
      }
      return this.normalizeRow(row);
    });
  }

  static async delete(knex: Knex, tenant: string, id: string): Promise<void> {
    const deleted = await settingsTable(knex, tenant).where({ time_period_settings_id: id }).delete();
    if (deleted === 0) {
      throw new TimePeriodSettingsRuleError('not_found', 'Time period settings not found');
    }
  }

  /** Midnight-UTC effective dates, ISO timestamps, and the semi-monthly defaults filled in. */
  private static normalizeRow(row: TimePeriodSettingsRow): ITimePeriodSettings {
    return {
      ...row,
      effective_from: toDateOnly(row.effective_from),
      effective_to: row.effective_to ? toDateOnly(row.effective_to) : undefined,
      created_at: formatISO(new Date(row.created_at)),
      updated_at: formatISO(new Date(row.updated_at)),
      start_month: row.start_month || 1,
      end_month: row.end_month || 12,
      start_day_of_month: row.start_day_of_month || 1,
      end_day_of_month: row.end_day_of_month || END_OF_PERIOD,
    };
  }

  private static toISO8601(date: Date | string): ISO8601String {
    if (typeof date === 'string') {
      date = new Date(date);
    }

    return format(toZonedTime(date, 'UTC'), "yyyy-MM-dd'T'HH:mm:ss.SSS'Z'") as ISO8601String;
  }
}

function definedFields<T extends object>(patch: T): Partial<T> {
  return Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined)) as Partial<T>;
}

/** Today in the user's timezone; UTC when there is no user or the timezone can't be resolved. */
async function resolveLocalToday(knex: Knex, tenant: string, userId: string | null): Promise<Temporal.PlainDate> {
  let timeZone = 'UTC';
  if (userId) {
    try {
      timeZone = (await resolveUserTimeZone(knex, tenant, userId)) || 'UTC';
    } catch (tzError) {
      console.warn('Could not resolve user timezone for effective_from default; using UTC', tzError);
    }
  }
  try {
    return Temporal.Now.plainDateISO(timeZone);
  } catch {
    console.warn(`Unknown timezone "${timeZone}" for effective_from default; using UTC`);
    return Temporal.Now.plainDateISO('UTC');
  }
}

function getEndOfPeriodDay(period: ITimePeriodSettings, month?: number): number {
  if (period.frequency_unit === 'week') {
    return 7;
  } else if (period.frequency_unit === 'month') {
    // If no specific month is provided, use the current month
    const currentDate = new Date();
    const targetMonth = month !== undefined ? month - 1 : currentDate.getMonth();
    const targetYear = currentDate.getFullYear();
    return getDaysInMonth(new Date(targetYear, targetMonth));
  } else if (period.frequency_unit === 'year') {
    const month = period.end_month || 12;
    const currentYear = new Date().getFullYear();
    return getDaysInMonth(new Date(currentYear, month - 1));
  }
  return 31; // Default fallback
}

function doPeriodsOverlap(period1: Pick<ITimePeriodSettings, 'frequency_unit' | 'start_day' | 'end_day' | 'start_month' | 'end_month' | 'start_day_of_month' | 'end_day_of_month'>, period2: ITimePeriodSettings): boolean {
  // If frequency units are different, we consider it an overlap
  // This is a safety measure as comparing different units is complex
  if (period1.frequency_unit !== period2.frequency_unit) {
    return true;
  }

  let period1Start: number, period1End: number, period2Start: number, period2End: number;
  let p1StartMonth: number, p1EndMonth: number, p1StartDay: number, p1EndDay: number;
  let p2StartMonth: number, p2EndMonth: number, p2StartDay: number, p2EndDay: number;
  let p1Start: number, p1End: number, p2Start: number, p2End: number;
  const p1 = period1 as ITimePeriodSettings;

  switch (period1.frequency_unit) {
    case 'month':
      period1Start = p1.start_day || 1;
      period1End = p1.end_day === END_OF_PERIOD ? getEndOfPeriodDay(p1) : p1.end_day || getEndOfPeriodDay(p1);
      period2Start = period2.start_day || 1;
      period2End = period2.end_day === END_OF_PERIOD ? getEndOfPeriodDay(period2) : period2.end_day || getEndOfPeriodDay(period2);

      // Periods overlap if one period's start falls within another period's range
      // Note: We use < for end comparison, not <= as specified in requirements
      return (
        (period1Start < period2End && period1Start >= period2Start) ||
        (period2Start < period1End && period2Start >= period1Start)
      );

    case 'year':
      p1StartMonth = p1.start_month || 1;
      p1EndMonth = p1.end_month || 12;
      p1StartDay = p1.start_day_of_month || 1;
      p1EndDay = p1.end_day_of_month === END_OF_PERIOD ?
        getEndOfPeriodDay(p1, p1EndMonth) :
        p1.end_day_of_month || getEndOfPeriodDay(p1, p1EndMonth);

      p2StartMonth = period2.start_month || 1;
      p2EndMonth = period2.end_month || 12;
      p2StartDay = period2.start_day_of_month || 1;
      p2EndDay = period2.end_day_of_month === END_OF_PERIOD ?
        getEndOfPeriodDay(period2, p2EndMonth) :
        period2.end_day_of_month || getEndOfPeriodDay(period2, p2EndMonth);

      // Convert to comparable numbers (month * 100 + day)
      p1Start = p1StartMonth * 100 + p1StartDay;
      p1End = p1EndMonth * 100 + p1EndDay;
      p2Start = p2StartMonth * 100 + p2StartDay;
      p2End = p2EndMonth * 100 + p2EndDay;

      // Check for overlap using the same logic as monthly periods
      return (
        (p1Start < p2End && p1Start >= p2Start) ||
        (p2Start < p1End && p2Start >= p1Start)
      );

    // For day and week frequency units, we consider any overlap in effective dates as an overlap
    default:
      return true;
  }
}

function invalid(message: string): never {
  throw new TimePeriodSettingsRuleError('invalid', message);
}

async function validateTimePeriodSettings(settings: NormalizedSettings, db: Knex | Knex.Transaction, excludeId?: string): Promise<void> {
  if (!settings.frequency || settings.frequency <= 0) {
    invalid('Frequency must be a positive number');
  }

  if (!['day', 'week', 'month', 'year'].includes(settings.frequency_unit)) {
    invalid('Invalid frequency unit');
  }

  if (settings.start_day && (settings.start_day < 1 || settings.start_day > 31)) {
    invalid('Start day must be between 1 and 31');
  }

  if (settings.end_day && settings.end_day !== END_OF_PERIOD && (settings.end_day < 1 || settings.end_day > 31)) {
    invalid('End day must be between 1 and 31, or 0 to indicate end of period');
  }

  if (settings.start_month && (settings.start_month < 1 || settings.start_month > 12)) {
    invalid('Start month must be between 1 and 12');
  }

  if (settings.end_month && (settings.end_month < 1 || settings.end_month > 12)) {
    invalid('End month must be between 1 and 12');
  }

  if (settings.start_day_of_month && (settings.start_day_of_month < 1 || settings.start_day_of_month > 31)) {
    invalid('Start day of month must be between 1 and 31');
  }

  if (settings.end_day_of_month && settings.end_day_of_month !== END_OF_PERIOD && (settings.end_day_of_month < 1 || settings.end_day_of_month > 31)) {
    invalid('End day of month must be between 1 and 31, or 0 to indicate end of period');
  }

  // effective_to is the last day the setting is in force, so it may equal effective_from. Both are
  // formatUtcDateNoTime strings here, which compare correctly as text.
  if (settings.effective_to && settings.effective_to < settings.effective_from) {
    invalid('Effective to must be on or after effective from');
  }

  // Inactive settings are ignored by period generation, so they cannot overlap anything.
  if (!settings.is_active) {
    return;
  }

  // Convert dates for database comparison
  const effectiveFrom = new Date(settings.effective_from);
  const effectiveTo = settings.effective_to ? new Date(settings.effective_to) : null;

  // Check for overlapping periods within the same tenant
  let query = tenantDb(db, settings.tenant).table<ITimePeriodSettings>('time_period_settings')
    .where('is_active', true);

  // Add conditions for overlapping effective dates
  query = query.andWhere(builder => {
    // Case 1: New period starts during an existing period
    builder.orWhere(builder => {
      builder
        .where('effective_from', '<', effectiveFrom)
        .andWhere(builder => {
          builder
            .whereNull('effective_to')
            // LEVERAGE: friction effective-to-inclusivity — treated as exclusive here, inclusive in
            // isSettingEffectiveOn; TimePeriodSettings.create's default hand-off starts the day after effective_to.
            .orWhere('effective_to', '>', effectiveFrom);
        });
    });

    // Case 2: New period ends during an existing period
    if (effectiveTo) {
      builder.orWhere(builder => {
        builder
          .where('effective_from', '<', effectiveTo)
          .andWhere(builder => {
            builder
              .whereNull('effective_to')
              .orWhere('effective_to', '>', effectiveTo);
          });
      });
    }

    // Case 3: New period completely encompasses an existing period
    builder.orWhere(builder => {
      builder.where('effective_from', '>=', effectiveFrom);
      if (effectiveTo) {
        builder.andWhere('effective_from', '<', effectiveTo);
      }
    });
  });

  // Exclude the current record when updating
  if (excludeId) {
    query = query.whereNot('time_period_settings_id', excludeId);
  }

  const overlappingPeriods = await query;

  // For each potentially overlapping period based on effective dates,
  // check if the actual time periods (days/months) overlap
  for (const existingPeriod of overlappingPeriods) {
    if (doPeriodsOverlap(settings, existingPeriod)) {
      console.error('Found overlapping time periods:', {
        new: {
          effectiveFrom: settings.effective_from,
          effectiveTo: settings.effective_to,
          frequency: settings.frequency,
          frequencyUnit: settings.frequency_unit,
          startDay: settings.start_day,
          endDay: settings.end_day,
          startMonth: settings.start_month,
          endMonth: settings.end_month,
          startDayOfMonth: settings.start_day_of_month,
          endDayOfMonth: settings.end_day_of_month
        },
        existing: {
          id: existingPeriod.time_period_settings_id,
          effectiveFrom: existingPeriod.effective_from,
          effectiveTo: existingPeriod.effective_to,
          frequency: existingPeriod.frequency,
          frequencyUnit: existingPeriod.frequency_unit,
          startDay: existingPeriod.start_day,
          endDay: existingPeriod.end_day,
          startMonth: existingPeriod.start_month,
          endMonth: existingPeriod.end_month,
          startDayOfMonth: existingPeriod.start_day_of_month,
          endDayOfMonth: existingPeriod.end_day_of_month
        }
      });
      throw new TimePeriodSettingsRuleError('overlap', 'The specified time period overlaps with existing time periods');
    }
  }
}
