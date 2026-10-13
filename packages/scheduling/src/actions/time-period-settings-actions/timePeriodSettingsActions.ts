'use server'
import { createTenantKnex, tenantDb, withTransaction } from '@alga-psa/db';
import { ITimePeriodSettings } from '@alga-psa/types';
import { formatISO } from 'date-fns';
import { validateData, validateArray } from '@alga-psa/core';
import { timePeriodSettingsSchema } from '../../schemas/timeSheet.schemas';
import { formatUtcDateNoTime } from '@alga-psa/core';
import { Knex } from 'knex';
import {
  TimePeriodSettings,
  TimePeriodSettingsRuleError,
  type TimePeriodSettingsFields,
} from '../../models/timePeriodSettings';
import { withAuth } from '@alga-psa/auth';
import {
  actionError,
  isActionMessageError,
  isActionPermissionError,
  type ActionMessageError,
  type ActionPermissionError,
} from '@alga-psa/ui/lib/errorHandling';

// Special value to indicate end of period
const END_OF_PERIOD = 0;

export type TimePeriodSettingsActionError = ActionMessageError | ActionPermissionError;
type TimePeriodSettingsActionResult<T> = T | TimePeriodSettingsActionError;

function timePeriodSettingsActionErrorFrom(error: unknown, fallback: string): TimePeriodSettingsActionError {
  if (isActionMessageError(error) || isActionPermissionError(error)) {
    return error as TimePeriodSettingsActionError;
  }

  // Business-rule failures (invalid fields, overlaps, missing rows) carry user-facing messages.
  if (error instanceof TimePeriodSettingsRuleError) {
    return actionError(error.message);
  }

  const dbError = error as { code?: string; column?: string };
  if (dbError?.code === '22P02') {
    return actionError('One of the time period setting values is invalid. Please refresh and try again.', 'msp/time-entry:errors.timePeriodSettings.invalidValue');
  }
  if (dbError?.code === '23502') {
    return dbError.column
      ? actionError(
          `Missing required time period setting field: ${dbError.column}.`,
          'msp/time-entry:errors.timePeriodSettings.missingFieldNamed',
          { field: dbError.column },
        )
      : actionError('Missing required time period setting field.', 'msp/time-entry:errors.timePeriodSettings.missingField');
  }
  if (dbError?.code === '23503') {
    return actionError('The selected time period setting is no longer valid. Please refresh and try again.', 'msp/time-entry:errors.timePeriodSettings.referenceMissing');
  }
  if (dbError?.code === '23505') {
    return actionError('A conflicting time period setting already exists.', 'msp/time-entry:errors.timePeriodSettings.duplicate');
  }

  return actionError(fallback);
}

export const getActiveTimePeriodSettings = withAuth(async (
  _user,
  { tenant }
): Promise<TimePeriodSettingsActionResult<ITimePeriodSettings[]>> => {
  try {
    const { knex: db } = await createTenantKnex();

    const activeSettings = await withTransaction(db, async (trx: Knex.Transaction) => {
      return await tenantDb(trx, tenant).table<ITimePeriodSettings>('time_period_settings')
        .where({ is_active: true })
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

    return validateArray(timePeriodSettingsSchema, activeSettings) as ITimePeriodSettings[];
  } catch (error) {
    console.error('Error fetching active time period settings:', error);
    return timePeriodSettingsActionErrorFrom(error, 'Failed to fetch time period settings');
  }
});

export const updateTimePeriodSettings = withAuth(async (
  _user,
  { tenant },
  settings: ITimePeriodSettings
): Promise<TimePeriodSettingsActionResult<void>> => {
  try {
    const { knex: db } = await createTenantKnex();

    // Validate input settings
    const validatedSettings = validateData(timePeriodSettingsSchema, {
      ...settings,
      effective_from: formatUtcDateNoTime(new Date(settings.effective_from)),
      effective_to: settings.effective_to ? formatUtcDateNoTime(new Date(settings.effective_to)) : undefined,
      created_at: formatISO(new Date(settings.created_at)),
      updated_at: formatISO(new Date())
    });

    // Business rules and overlap checks live in the model, shared with the REST API.
    await TimePeriodSettings.update(db, tenant, validatedSettings.time_period_settings_id, {
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
    });
  } catch (error) {
    console.error('Error updating time period settings:', error);
    return timePeriodSettingsActionErrorFrom(error, 'Failed to update time period settings');
  }
});

export const createTimePeriodSettings = withAuth(async (
  user,
  { tenant },
  settings: Partial<ITimePeriodSettings>
): Promise<TimePeriodSettingsActionResult<ITimePeriodSettings>> => {
  try {
    const { knex: db } = await createTenantKnex();

    // The model defaults a missing effective_from (the user-timezone period start, handed off past
    // ended settings), validates the business rules and rejects overlaps; the REST API shares it.
    const created = await TimePeriodSettings.create(db, tenant, settings as TimePeriodSettingsFields, {
      userId: user?.user_id || null,
    });

    return validateData(timePeriodSettingsSchema, created) as ITimePeriodSettings;
  } catch (error) {
    console.error('Error creating time period settings:', error);
    return timePeriodSettingsActionErrorFrom(error, 'Failed to create time period settings');
  }
});

export const deleteTimePeriodSettings = withAuth(async (
  _user,
  { tenant },
  settingId: string
): Promise<TimePeriodSettingsActionResult<void>> => {
  try {
    const { knex: db } = await createTenantKnex();
    await TimePeriodSettings.delete(db, tenant, settingId);
  } catch (error) {
    console.error('Error deleting time period settings:', error);
    return timePeriodSettingsActionErrorFrom(error, 'Failed to delete time period settings');
  }
});
