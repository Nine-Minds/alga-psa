'use server'
import { delegateToTimeSource } from '../../lib/timeSource';
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
import { hasPermission, withAuth } from '@alga-psa/auth';
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

// Time period settings decide every tenant's time-sheet cadence, so reading them needs
// `time_period:read` and changing them needs `time_period:manage` — the same split the
// v1 API applies in ApiTimeSheetController.
const TIME_PERIOD_SETTINGS_PERMISSION_MESSAGES: Record<'read' | 'manage', string> = {
  read: 'Permission denied: cannot view time period settings.',
  manage: 'Permission denied: cannot manage time period settings.',
};

async function timePeriodSettingsPermissionError(
  user: Parameters<typeof hasPermission>[0],
  action: 'read' | 'manage',
  db: Knex | Knex.Transaction
): Promise<ActionPermissionError | null> {
  if (await hasPermission(user, 'time_period', action, db)) {
    return null;
  }
  return permissionError(
    TIME_PERIOD_SETTINGS_PERMISSION_MESSAGES[action],
    `msp/time-entry:errors.timePeriodSettings.permissions.${action}`
  );
}

export const getActiveTimePeriodSettings = withAuth(async (
  user,
  { tenant }
): Promise<TimePeriodSettingsActionResult<ITimePeriodSettings[]>> => {
  // Time-source seam: a registered non-native source may own this call; native falls through untouched (0 statements).
  const delegated = await delegateToTimeSource({ tenant, userId: user.user_id }, (source, ctx) => source.periods.readActiveSettings(ctx));
  if (delegated.handled) return delegated.value;
  try {
    const { knex: db } = await createTenantKnex();

    const denied = await timePeriodSettingsPermissionError(user, 'read', db);
    if (denied) {
      return denied;
    }

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
  user,
  { tenant },
  settings: ITimePeriodSettings
): Promise<TimePeriodSettingsActionResult<void>> => {
  // Time-source seam: a registered non-native source may own this call; native falls through untouched (0 statements).
  const delegated = await delegateToTimeSource({ tenant, userId: user.user_id }, (source, ctx) => source.periods.updateSettings(ctx, settings));
  if (delegated.handled) return delegated.value;
  try {
    const { knex: db } = await createTenantKnex();

    const denied = await timePeriodSettingsPermissionError(user, 'manage', db);
    if (denied) {
      return denied;
    }

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
  // Time-source seam: a registered non-native source may own this call; native falls through untouched (0 statements).
  const delegated = await delegateToTimeSource({ tenant, userId: user.user_id }, (source, ctx) => source.periods.createSettings(ctx, settings));
  if (delegated.handled) return delegated.value;
  try {
    const { knex: db } = await createTenantKnex();

    const denied = await timePeriodSettingsPermissionError(user, 'manage', db);
    if (denied) {
      return denied;
    }

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
  user,
  { tenant },
  settingId: string
): Promise<TimePeriodSettingsActionResult<void>> => {
  // Time-source seam: a registered non-native source may own this call; native falls through untouched (0 statements).
  const delegated = await delegateToTimeSource({ tenant, userId: user.user_id }, (source, ctx) => source.periods.removeSettings(ctx, settingId));
  if (delegated.handled) return delegated.value;
  try {
    const { knex: db } = await createTenantKnex();
    const denied = await timePeriodSettingsPermissionError(user, 'manage', db);
    if (denied) {
      return denied;
    }

    await TimePeriodSettings.delete(db, tenant, settingId);
  } catch (error) {
    console.error('Error deleting time period settings:', error);
    return timePeriodSettingsActionErrorFrom(error, 'Failed to delete time period settings');
  }
});
