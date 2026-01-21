'use server'
import { createTenantKnex } from '@alga-psa/db';
import { withTransaction } from '@alga-psa/db';
import { ITimePeriod, ITimePeriodSettings } from '@alga-psa/types';
import { set, getDaysInMonth } from 'date-fns';
import { formatISO } from 'date-fns';
import { validateData, validateArray } from '@alga-psa/core';
import { timePeriodSettingsSchema } from '../../schemas/timeSheet.schemas';
import { formatUtcDateNoTime } from '@alga-psa/core';
import { Knex } from 'knex';
import { getCurrentUser } from '@alga-psa/users/actions';

// Special value to indicate end of period
const END_OF_PERIOD = 0;

async function getTenantKnex(): Promise<{ knex: Knex; tenant: string }> {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    throw new Error('No authenticated user found');
  }

  if (!currentUser.tenant) {
    throw new Error('Tenant is required');
  }

  const { knex, tenant } = await createTenantKnex(currentUser.tenant);
  if (!tenant) {
    throw new Error('SYSTEM_ERROR: Tenant context not found');
  }

  return { knex, tenant };
}

export async function getActiveTimePeriodSettings(): Promise<ITimePeriodSettings[]> {
  const { knex: db, tenant } = await getTenantKnex();

  const activeSettings = await withTransaction(db, async (trx: Knex.Transaction) => {
    return await trx<ITimePeriodSettings>('time_period_settings')
      .where({ is_active: true })
      .andWhere('tenant', tenant)
      .orderBy('effective_from', 'desc')
      .then(settings => settings.map((setting):ITimePeriodSettings => ({
        ...setting,
        effective_from: formatUtcDateNoTime(new Date(setting.effective_from)),
        effective_to: setting.effective_to ? formatUtcDateNoTime(new Date(setting.effective_to)) : undefined,
        created_at: formatISO(new Date(setting.created_at)),
        updated_at: formatISO(new Date(setting.updated_at)),
        start_month: setting.start_month || 1,
        end_month: setting.end_month || 12,
        start_day_of_month: setting.start_day_of_month || 1,
        end_day_of_month: setting.end_day_of_month || END_OF_PERIOD
      })));
  });

  return validateArray(timePeriodSettingsSchema, activeSettings);
}

export async function updateTimePeriodSettings(settings: ITimePeriodSettings): Promise<void> {
  const { knex: db, tenant } = await getTenantKnex();

  // Validate input settings
  const validatedSettings = validateData(timePeriodSettingsSchema, {
    ...settings,
    effective_from: formatUtcDateNoTime(new Date(settings.effective_from)),
    effective_to: settings.effective_to ? formatUtcDateNoTime(new Date(settings.effective_to)) : undefined,
    created_at: formatISO(new Date(settings.created_at)),
    updated_at: formatISO(new Date())
  });

  await withTransaction(db, async (trx: Knex.Transaction) => {
    // Validate business rules and check for overlaps
    await validateTimePeriodSettings({ ...validatedSettings, tenant }, trx, settings.time_period_settings_id);

    await trx('time_period_settings')
      .where({ time_period_settings_id: validatedSettings.time_period_settings_id })
      .andWhere('tenant', tenant)
      .update({
        frequency: validatedSettings.frequency,
        frequency_unit: validatedSettings.frequency_unit,
        is_active: validatedSettings.is_active,
        effective_from: validatedSettings.effective_from,
        effective_to: validatedSettings.effective_to,
        start_day: validatedSettings.start_day,
        end_day: validatedSettings.end_day,
        start_month: validatedSettings.start_month,
        start_day_of_month: validatedSettings.start_day_of_month,
        end_month: validatedSettings.end_month,
        end_day_of_month: validatedSettings.end_day_of_month,
        updated_at: validatedSettings.updated_at,
      });
  });
}

export async function createTimePeriodSettings(settings: Partial<ITimePeriodSettings>): Promise<ITimePeriodSettings> {
  const { knex: db, tenant } = await getTenantKnex();

  const now = formatISO(new Date());
  const newSettings = {
    ...settings,
    is_active: true,
    effective_from: settings.effective_from ? formatUtcDateNoTime(new Date(settings.effective_from)) : formatUtcDateNoTime(new Date()),
    effective_to: settings.effective_to ? formatUtcDateNoTime(new Date(settings.effective_to)) : undefined,
    start_day: settings.start_day || 1,
    end_day: settings.end_day || END_OF_PERIOD,
    start_month: settings.start_month || 1,
    start_day_of_month: settings.start_day_of_month || 1,
    end_month: settings.end_month || 12,
    end_day_of_month: settings.end_day_of_month || END_OF_PERIOD,
    created_at: now,
    updated_at: now,
    tenant: tenant,
  };

  const insertedSetting = await withTransaction(db, async (trx: Knex.Transaction) => {
    // Validate the business rules and check for overlaps before database insertion
    await validateTimePeriodSettings(newSettings, trx);

    // First insert into database to get the ID
    const [result] = await trx('time_period_settings')
      .insert({
        ...newSettings,
        effective_from: new Date(newSettings.effective_from),
        effective_to: newSettings.effective_to ? new Date(newSettings.effective_to) : null,
        created_at: new Date(newSettings.created_at),
        updated_at: new Date(newSettings.updated_at),
      })
      .returning('*');

    return result;
  });

  // Format all date fields as ISO strings before validation
  const formattedSetting = {
    ...insertedSetting,
    effective_from: formatUtcDateNoTime(new Date(insertedSetting.effective_from)),
    effective_to: insertedSetting.effective_to ? formatUtcDateNoTime(new Date(insertedSetting.effective_to)) : undefined,
    created_at: formatISO(new Date(insertedSetting.created_at)),
    updated_at: formatISO(new Date(insertedSetting.updated_at)),
    start_date: insertedSetting.start_date ? formatUtcDateNoTime(new Date(insertedSetting.start_date)) : undefined,
    end_date: insertedSetting.end_date ? formatUtcDateNoTime(new Date(insertedSetting.end_date)) : undefined
  };

  // NOTE: Recurring job scheduling is handled at a higher layer; avoid scheduling → jobs deps here.

  // Now validate the complete record with the schema
  return validateData(timePeriodSettingsSchema, formattedSetting);
}

export async function deleteTimePeriodSettings(settingId: string): Promise<void> {
  const { knex: db, tenant } = await getTenantKnex();

  await withTransaction(db, async (trx: Knex.Transaction) => {
    await trx('time_period_settings')
      .where({ time_period_settings_id: settingId })
      .andWhere('tenant', tenant)
      .delete();
  });
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

function doPeriodsOverlap(period1: ITimePeriodSettings, period2: ITimePeriodSettings): boolean {
  // If frequency units are different, we consider it an overlap
  // This is a safety measure as comparing different units is complex
  if (period1.frequency_unit !== period2.frequency_unit) {
    return true;
  }

  let period1Start: number, period1End: number, period2Start: number, period2End: number;
  let p1StartMonth: number, p1EndMonth: number, p1StartDay: number, p1EndDay: number;
  let p2StartMonth: number, p2EndMonth: number, p2StartDay: number, p2EndDay: number;
  let p1Start: number, p1End: number, p2Start: number, p2End: number;

  switch (period1.frequency_unit) {
    case 'month':
      period1Start = period1.start_day || 1;
      period1End = period1.end_day === END_OF_PERIOD ? getEndOfPeriodDay(period1) : period1.end_day || getEndOfPeriodDay(period1);
      period2Start = period2.start_day || 1;
      period2End = period2.end_day === END_OF_PERIOD ? getEndOfPeriodDay(period2) : period2.end_day || getEndOfPeriodDay(period2);

      // Periods overlap if one period's start falls within another period's range
      // Note: We use < for end comparison, not <= as specified in requirements
      return (
        (period1Start < period2End && period1Start >= period2Start) ||
        (period2Start < period1End && period2Start >= period1Start)
      );

    case 'year':
      p1StartMonth = period1.start_month || 1;
      p1EndMonth = period1.end_month || 12;
      p1StartDay = period1.start_day_of_month || 1;
      p1EndDay = period1.end_day_of_month === END_OF_PERIOD ? 
        getEndOfPeriodDay(period1, p1EndMonth) : 
        period1.end_day_of_month || getEndOfPeriodDay(period1, p1EndMonth);
      
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

async function validateTimePeriodSettings(settings: Partial<ITimePeriodSettings>, db: Knex | Knex.Transaction, excludeId?: string): Promise<void> {
  // Ensure we have tenant context for validation
  if (!settings.tenant) {
    throw new Error('Tenant context is required for time period settings validation');
  }
  if (settings.frequency && settings.frequency <= 0) {
    throw new Error('Frequency must be a positive number');
  }

  if (settings.frequency_unit && !['day', 'week', 'month', 'year'].includes(settings.frequency_unit)) {
    throw new Error('Invalid frequency unit');
  }

  if (settings.start_day && (settings.start_day < 1 || settings.start_day > 31)) {
    throw new Error('Start day must be between 1 and 31');
  }

  if (settings.end_day && settings.end_day !== END_OF_PERIOD && (settings.end_day < 1 || settings.end_day > 31)) {
    throw new Error('End day must be between 1 and 31, or 0 to indicate end of period');
  }

  if (settings.start_month && (settings.start_month < 1 || settings.start_month > 12)) {
    throw new Error('Start month must be between 1 and 12');
  }

  if (settings.end_month && (settings.end_month < 1 || settings.end_month > 12)) {
    throw new Error('End month must be between 1 and 12');
  }

  if (settings.start_day_of_month && (settings.start_day_of_month < 1 || settings.start_day_of_month > 31)) {
    throw new Error('Start day of month must be between 1 and 31');
  }

  if (settings.end_day_of_month && settings.end_day_of_month !== END_OF_PERIOD && (settings.end_day_of_month < 1 || settings.end_day_of_month > 31)) {
    throw new Error('End day of month must be between 1 and 31, or 0 to indicate end of period');
  }

  // Convert dates for database comparison
  const effectiveFrom = new Date(settings.effective_from!);
  const effectiveTo = settings.effective_to ? new Date(settings.effective_to) : null;

  // Check for overlapping periods within the same tenant
  let query = db<ITimePeriodSettings>('time_period_settings')
    .where('is_active', true)
    .andWhere('tenant', settings.tenant);

  // Add conditions for overlapping effective dates
  query = query.andWhere(builder => {
    // Case 1: New period starts during an existing period
    builder.orWhere(builder => {
      builder
        .where('effective_from', '<', effectiveFrom)
        .andWhere(builder => {
          builder
            .whereNull('effective_to')
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
    if (doPeriodsOverlap(settings as ITimePeriodSettings, existingPeriod)) {
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
      throw new Error('The specified time period overlaps with existing time periods');
    }
  }
}
