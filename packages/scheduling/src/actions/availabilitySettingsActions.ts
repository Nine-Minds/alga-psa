'use server'

import { createTenantKnex } from '@alga-psa/db';
import { withTransaction } from '@alga-psa/db';
import { Knex } from 'knex';
import { getCurrentUser } from '@alga-psa/users/actions';
import { hasPermission } from '@alga-psa/auth';
import { v4 as uuidv4 } from 'uuid';
import {
  availabilitySettingSchema,
  availabilityExceptionSchema,
  AvailabilitySettingInput,
  AvailabilityExceptionInput,
  AvailabilitySettingFilters
} from '../schemas/appointmentSchemas';

export interface IAvailabilitySetting {
  availability_setting_id: string;
  tenant: string;
  setting_type: 'user_hours' | 'service_rules' | 'general_settings';
  user_id?: string;
  service_id?: string;
  day_of_week?: number;
  start_time?: string;
  end_time?: string;
  is_available: boolean;
  buffer_before_minutes?: number;
  buffer_after_minutes?: number;
  max_appointments_per_day?: number;
  allow_without_contract?: boolean;
  advance_booking_days?: number;
  minimum_notice_hours?: number;
  config_json?: Record<string, any>;
  created_at: Date;
  updated_at: Date;
}

export interface IAvailabilityException {
  exception_id: string;
  tenant: string;
  user_id?: string;
  date: string;
  is_available: boolean;
  reason?: string;
  created_at: Date;
  updated_at: Date;
}

export interface AvailabilitySettingsResult<T> {
  success: boolean;
  data?: T;
  error?: string;
}

/**
 * Create or update an availability setting
 * If a matching setting exists (same type, user_id, service_id, day_of_week), it will be updated
 */
export async function createOrUpdateAvailabilitySetting(
  data: AvailabilitySettingInput & { availability_setting_id?: string }
): Promise<AvailabilitySettingsResult<IAvailabilitySetting>> {
  try {
    const currentUser = await getCurrentUser();
    if (!currentUser) {
      return { success: false, error: 'User not authenticated' };
    }

    // Validate input
    const validatedData = availabilitySettingSchema.parse(data);

    const { knex: db, tenant } = await createTenantKnex();

    // Check permissions
    const canManage = await hasPermission(currentUser as any, 'system_settings', 'update', db);
    if (!canManage) {
      return { success: false, error: 'Insufficient permissions to manage availability settings' };
    }

    const result = await withTransaction(db, async (trx: Knex.Transaction) => {
      const now = new Date();

      // Check if updating existing setting
      if (data.availability_setting_id) {
        const existing = await trx('availability_settings')
          .where({
            availability_setting_id: data.availability_setting_id,
            tenant
          })
          .first();

        if (!existing) {
          throw new Error('Availability setting not found');
        }

        // Update existing setting
        await trx('availability_settings')
          .where({
            availability_setting_id: data.availability_setting_id,
            tenant
          })
          .update({
            ...validatedData,
            updated_at: now
          });

        const updated = await trx('availability_settings')
          .where({
            availability_setting_id: data.availability_setting_id,
            tenant
          })
          .first();

        return updated as IAvailabilitySetting;
      }

      // Check for existing setting with same criteria
      let query = trx('availability_settings')
        .where({
          tenant,
          setting_type: validatedData.setting_type
        });

      if (validatedData.user_id) {
        query = query.where({ user_id: validatedData.user_id });
      } else {
        query = query.whereNull('user_id');
      }

      if (validatedData.service_id) {
        query = query.where({ service_id: validatedData.service_id });
      } else {
        query = query.whereNull('service_id');
      }

      if (validatedData.day_of_week !== undefined) {
        query = query.where({ day_of_week: validatedData.day_of_week });
      } else {
        query = query.whereNull('day_of_week');
      }

      const existing = await query.first();

      if (existing) {
        // Update existing
        await trx('availability_settings')
          .where({
            availability_setting_id: existing.availability_setting_id,
            tenant
          })
          .update({
            ...validatedData,
            updated_at: now
          });

        const updated = await trx('availability_settings')
          .where({
            availability_setting_id: existing.availability_setting_id,
            tenant
          })
          .first();

        return updated as IAvailabilitySetting;
      }

      // Create new setting
      const settingId = uuidv4();
      const newSetting = {
        availability_setting_id: settingId,
        tenant,
        ...validatedData,
        created_at: now,
        updated_at: now
      };

      await trx('availability_settings').insert(newSetting);

      const created = await trx('availability_settings')
        .where({
          availability_setting_id: settingId,
          tenant
        })
        .first();

      return created as IAvailabilitySetting;
    });

    return { success: true, data: result };
  } catch (error) {
    console.error('Error creating/updating availability setting:', error);
    const message = error instanceof Error ? error.message : 'Failed to create/update availability setting';
    return { success: false, error: message };
  }
}

/**
 * Get availability settings with optional filters
 */
export async function getAvailabilitySettings(
  filters?: AvailabilitySettingFilters
): Promise<AvailabilitySettingsResult<IAvailabilitySetting[]>> {
  try {
    const currentUser = await getCurrentUser();
    if (!currentUser) {
      return { success: false, error: 'User not authenticated' };
    }

    const { knex: db, tenant } = await createTenantKnex();

    // Check permissions
    const canRead = await hasPermission(currentUser as any, 'system_settings', 'read', db);
    if (!canRead) {
      return { success: false, error: 'Insufficient permissions to view availability settings' };
    }

    const settings = await withTransaction(db, async (trx: Knex.Transaction) => {
      let query = trx('availability_settings')
        .where({ tenant })
        .orderBy('created_at', 'desc');

      if (filters) {
        if (filters.setting_type) {
          query = query.where({ setting_type: filters.setting_type });
        }
        if (filters.user_id) {
          query = query.where({ user_id: filters.user_id });
        }
        if (filters.service_id) {
          query = query.where({ service_id: filters.service_id });
        }
        if (filters.day_of_week !== undefined) {
          query = query.where({ day_of_week: filters.day_of_week });
        }
      }

      return await query;
    });

    return { success: true, data: settings as IAvailabilitySetting[] };
  } catch (error) {
    console.error('Error fetching availability settings:', error);
    const message = error instanceof Error ? error.message : 'Failed to fetch availability settings';
    return { success: false, error: message };
  }
}

/**
 * Delete an availability setting
 */
export async function deleteAvailabilitySetting(
  settingId: string
): Promise<AvailabilitySettingsResult<void>> {
  try {
    const currentUser = await getCurrentUser();
    if (!currentUser) {
      return { success: false, error: 'User not authenticated' };
    }

    const { knex: db, tenant } = await createTenantKnex();

    // Check permissions
    const canDelete = await hasPermission(currentUser as any, 'system_settings', 'delete', db);
    if (!canDelete) {
      return { success: false, error: 'Insufficient permissions to delete availability settings' };
    }

    await withTransaction(db, async (trx: Knex.Transaction) => {
      const setting = await trx('availability_settings')
        .where({
          availability_setting_id: settingId,
          tenant
        })
        .first();

      if (!setting) {
        throw new Error('Availability setting not found');
      }

      await trx('availability_settings')
        .where({
          availability_setting_id: settingId,
          tenant
        })
        .del();
    });

    return { success: true };
  } catch (error) {
    console.error('Error deleting availability setting:', error);
    const message = error instanceof Error ? error.message : 'Failed to delete availability setting';
    return { success: false, error: message };
  }
}

/**
 * Add an availability exception (holiday, time off, etc.)
 */
export async function addAvailabilityException(
  data: AvailabilityExceptionInput
): Promise<AvailabilitySettingsResult<IAvailabilityException>> {
  try {
    const currentUser = await getCurrentUser();
    if (!currentUser) {
      return { success: false, error: 'User not authenticated' };
    }

    // Validate input
    const validatedData = availabilityExceptionSchema.parse(data);

    const { knex: db, tenant } = await createTenantKnex();

    // Check permissions
    const canManage = await hasPermission(currentUser as any, 'system_settings', 'update', db);
    if (!canManage) {
      return { success: false, error: 'Insufficient permissions to manage availability exceptions' };
    }

    const exception = await withTransaction(db, async (trx: Knex.Transaction) => {
      const now = new Date();

      // Check if exception already exists for this user/date
      let query = trx('availability_exceptions')
        .where({
          tenant,
          date: validatedData.date
        });

      if (validatedData.user_id) {
        query = query.where({ user_id: validatedData.user_id });
      } else {
        query = query.whereNull('user_id');
      }

      const existing = await query.first();

      if (existing) {
        // Update existing exception
        await trx('availability_exceptions')
          .where({
            exception_id: existing.exception_id,
            tenant
          })
          .update({
            is_available: validatedData.is_available,
            reason: validatedData.reason,
            updated_at: now
          });

        const updated = await trx('availability_exceptions')
          .where({
            exception_id: existing.exception_id,
            tenant
          })
          .first();

        return updated as IAvailabilityException;
      }

      // Create new exception
      const exceptionId = uuidv4();
      const newException = {
        exception_id: exceptionId,
        tenant,
        ...validatedData,
        created_at: now,
        updated_at: now
      };

      await trx('availability_exceptions').insert(newException);

      const created = await trx('availability_exceptions')
        .where({
          exception_id: exceptionId,
          tenant
        })
        .first();

      return created as IAvailabilityException;
    });

    return { success: true, data: exception };
  } catch (error) {
    console.error('Error adding availability exception:', error);
    const message = error instanceof Error ? error.message : 'Failed to add availability exception';
    return { success: false, error: message };
  }
}

/**
 * Get availability exceptions with optional filters
 */
export async function getAvailabilityExceptions(
  userId?: string,
  dateRange?: { from: string; to: string }
): Promise<AvailabilitySettingsResult<IAvailabilityException[]>> {
  try {
    const currentUser = await getCurrentUser();
    if (!currentUser) {
      return { success: false, error: 'User not authenticated' };
    }

    const { knex: db, tenant } = await createTenantKnex();

    // Check permissions
    const canRead = await hasPermission(currentUser as any, 'system_settings', 'read', db);
    if (!canRead) {
      return { success: false, error: 'Insufficient permissions to view availability exceptions' };
    }

    const exceptions = await withTransaction(db, async (trx: Knex.Transaction) => {
      let query = trx('availability_exceptions')
        .where({ tenant })
        .orderBy('date', 'asc');

      if (userId) {
        query = query.where({ user_id: userId });
      }

      if (dateRange) {
        query = query.whereBetween('date', [dateRange.from, dateRange.to]);
      }

      return await query;
    });

    return { success: true, data: exceptions as IAvailabilityException[] };
  } catch (error) {
    console.error('Error fetching availability exceptions:', error);
    const message = error instanceof Error ? error.message : 'Failed to fetch availability exceptions';
    return { success: false, error: message };
  }
}

/**
 * Delete an availability exception
 */
export async function deleteAvailabilityException(
  exceptionId: string
): Promise<AvailabilitySettingsResult<void>> {
  try {
    const currentUser = await getCurrentUser();
    if (!currentUser) {
      return { success: false, error: 'User not authenticated' };
    }

    const { knex: db, tenant } = await createTenantKnex();

    // Check permissions
    const canDelete = await hasPermission(currentUser as any, 'system_settings', 'delete', db);
    if (!canDelete) {
      return { success: false, error: 'Insufficient permissions to delete availability exceptions' };
    }

    await withTransaction(db, async (trx: Knex.Transaction) => {
      const exception = await trx('availability_exceptions')
        .where({
          exception_id: exceptionId,
          tenant
        })
        .first();

      if (!exception) {
        throw new Error('Availability exception not found');
      }

      await trx('availability_exceptions')
        .where({
          exception_id: exceptionId,
          tenant
        })
        .del();
    });

    return { success: true };
  } catch (error) {
    console.error('Error deleting availability exception:', error);
    const message = error instanceof Error ? error.message : 'Failed to delete availability exception';
    return { success: false, error: message };
  }
}
