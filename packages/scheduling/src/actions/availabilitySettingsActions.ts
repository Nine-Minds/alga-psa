'use server'

import { createTenantKnex, tenantDb, withTransaction } from '@alga-psa/db';
import { Knex } from 'knex';
import { withAuth, hasPermission } from '@alga-psa/auth';
import { isEnterprise } from '@alga-psa/core/features';
import { ADD_ONS, IUser } from '@alga-psa/types';
import { v4 as uuidv4 } from 'uuid';
import {
  availabilitySettingSchema,
  availabilityExceptionSchema,
  availabilityUserHoursWeekSchema,
  AvailabilitySettingInput,
  AvailabilityExceptionInput,
  AvailabilitySettingFilters,
  AvailabilityUserHoursWeekInput
} from '../schemas/appointmentSchemas';
import { normalizeAvailabilityTime } from '../lib/availabilityUserHours';

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

export interface AvailabilityAccessUser {
  user_id: string;
  username: string;
  first_name?: string;
  last_name?: string;
  email: string;
  is_inactive: boolean;
  tenant: string;
  user_type: 'internal';
  reports_to?: string | null;
}

export interface AvailabilityAccessTeam {
  team_id: string;
  team_name: string;
  manager_id: string | null;
  member_ids: string[];
}

export interface AvailabilitySettingsAccess {
  canReadSystemSettings: boolean;
  canManageSystemSettings: boolean;
  canManageUserHours: boolean;
  users: AvailabilityAccessUser[];
  teams: AvailabilityAccessTeam[];
}

export interface TeamsMeetingsTabState {
  visible: boolean;
  organizerUpn?: string | null;
}

export interface TeamsMeetingOrganizerState {
  organizerUpn: string | null;
}

export interface TeamsMeetingOrganizerVerification {
  valid: boolean;
  displayName?: string;
  reason?: 'ee_disabled' | 'addon_required' | 'not_configured' | 'user_not_found' | 'policy_missing' | 'graph_error';
}

function availabilityActionErrorMessage(error: unknown, fallback: string): string {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : '';

  if (error instanceof Error && error.name === 'ZodError') {
    return 'Availability settings contain invalid fields. Check required fields and time ranges.';
  }

  if (
    message === 'Availability setting not found' ||
    message === 'Availability exception not found'
  ) {
    return message;
  }

  return fallback;
}

async function getScopedUserIds(db: Knex | Knex.Transaction, tenant: string, actorUserId: string): Promise<Set<string>> {
  const scopedDb = tenantDb(db, tenant);
  const managedTeams = await scopedDb.table('teams')
    .where({ manager_id: actorUserId })
    .select('team_id');
  const teamIds = managedTeams.map((team) => team.team_id);

  const [members, directReports] = await Promise.all([
    teamIds.length > 0
      ? scopedDb.table('team_members').whereIn('team_id', teamIds).select('user_id')
      : Promise.resolve([]),
    scopedDb.table('users').where({ reports_to: actorUserId, user_type: 'internal', is_inactive: false }).select('user_id'),
  ]);

  return new Set([...members, ...directReports].map((row) => row.user_id));
}

async function canAccessUserHours(
  db: Knex | Knex.Transaction,
  tenant: string,
  user: IUser,
  action: 'read' | 'update' | 'delete',
  targetUserId?: string,
): Promise<{ allowed: boolean; hasSystemAccess: boolean; scopedUserIds: Set<string> }> {
  const hasSystemAccess = await hasPermission(user, 'system_settings', action, db)
    || (action === 'read' && await hasPermission(user, 'system_settings', 'update', db));
  if (hasSystemAccess) {
    return { allowed: true, hasSystemAccess: true, scopedUserIds: new Set() };
  }

  const scopedUserIds = await getScopedUserIds(db, tenant, user.user_id);
  return {
    allowed: targetUserId ? scopedUserIds.has(targetUserId) : scopedUserIds.size > 0,
    hasSystemAccess: false,
    scopedUserIds,
  };
}

export const getAvailabilitySettingsAccess = withAuth(async (
  user,
  { tenant }
): Promise<AvailabilitySettingsResult<AvailabilitySettingsAccess>> => {
  try {
    const { knex: db } = await createTenantKnex();
    const [canReadSystemSettings, canManageSystemSettings, scopedUserIds] = await Promise.all([
      hasPermission(user, 'system_settings', 'read', db),
      hasPermission(user, 'system_settings', 'update', db),
      getScopedUserIds(db, tenant, user.user_id),
    ]);
    const scopedDb = tenantDb(db, tenant);
    const hasTenantWideAccess = canReadSystemSettings || canManageSystemSettings;

    const usersQuery = scopedDb.table('users')
      .where({ user_type: 'internal', is_inactive: false })
      .select('user_id', 'username', 'first_name', 'last_name', 'email', 'is_inactive', 'tenant', 'user_type', 'reports_to')
      .orderBy('first_name')
      .orderBy('last_name');
    if (!hasTenantWideAccess) {
      usersQuery.whereIn('user_id', Array.from(scopedUserIds));
    }

    const teamsQuery = scopedDb.table('teams')
      .select('team_id', 'team_name', 'manager_id')
      .orderBy('team_name');
    if (!hasTenantWideAccess) {
      teamsQuery.where({ manager_id: user.user_id });
    }

    const [users, teams] = await Promise.all([usersQuery, teamsQuery]);
    const teamIds = teams.map((team) => team.team_id);
    const memberships = teamIds.length > 0
      ? await scopedDb.table('team_members').whereIn('team_id', teamIds).select('team_id', 'user_id')
      : [];

    return {
      success: true,
      data: {
        canReadSystemSettings,
        canManageSystemSettings,
        canManageUserHours: canManageSystemSettings || scopedUserIds.size > 0,
        users: users as AvailabilityAccessUser[],
        teams: teams.map((team) => ({
          ...team,
          member_ids: memberships.filter((member) => member.team_id === team.team_id).map((member) => member.user_id),
        })),
      },
    };
  } catch (error) {
    console.error('Error loading availability access:', error);
    return { success: false, error: 'Failed to load availability access' };
  }
});

async function tenantHasTeamsAddOn(db: any, tenant: string): Promise<boolean> {
  const scopedDb = tenantDb(db, tenant);
  const row = await scopedDb.table('tenant_addons')
    .where({ addon_key: ADD_ONS.TEAMS })
    .andWhere((builder: any) => {
      builder.whereNull('expires_at').orWhere('expires_at', '>', db.fn.now());
    })
    .first('addon_key');

  return Boolean(row);
}

export const getTeamsMeetingsTabState = withAuth(async (
  user,
  { tenant }
): Promise<AvailabilitySettingsResult<TeamsMeetingsTabState>> => {
  try {
    const { knex: db } = await createTenantKnex();
    const canRead = await hasPermission(user, 'system_settings', 'read', db);
    if (!canRead) {
      return { success: false, error: 'Insufficient permissions to view availability settings' };
    }

    const hasTeamsIntegrationsTable = await db.schema.hasTable('teams_integrations');
    if (!hasTeamsIntegrationsTable) {
      return { success: true, data: { visible: false, organizerUpn: null } };
    }

    if (!(await tenantHasTeamsAddOn(db, tenant))) {
      return { success: true, data: { visible: false, organizerUpn: null } };
    }

    const integration = await tenantDb(db, tenant).table('teams_integrations')
      .select('install_status', 'default_meeting_organizer_upn')
      .first();

    return {
      success: true,
      data: {
        visible: integration?.install_status === 'active',
        organizerUpn: integration?.default_meeting_organizer_upn ?? null,
      },
    };
  } catch (error) {
    console.error('Error loading Teams meetings tab state:', error);
    const message = availabilityActionErrorMessage(error, 'Failed to load Teams meetings tab state');
    return { success: false, error: message };
  }
});

export const setDefaultMeetingOrganizer = withAuth(async (
  user,
  { tenant },
  input: { upn?: string | null }
): Promise<AvailabilitySettingsResult<TeamsMeetingOrganizerState>> => {
  try {
    const { knex: db } = await createTenantKnex();
    const canManage = await hasPermission(user, 'system_settings', 'update', db);
    if (!canManage) {
      return { success: false, error: 'Insufficient permissions to manage Teams meeting settings' };
    }

    const hasTeamsIntegrationsTable = await db.schema.hasTable('teams_integrations');
    if (!hasTeamsIntegrationsTable) {
      return { success: false, error: 'Teams integration is not available in this environment' };
    }

    if (!(await tenantHasTeamsAddOn(db, tenant))) {
      return { success: false, error: 'Microsoft Teams meetings require the Teams add-on.' };
    }

    const scopedDb = tenantDb(db, tenant);
    const integration = await scopedDb.table('teams_integrations')
      .select('tenant', 'install_status')
      .first();

    if (!integration || integration.install_status !== 'active') {
      return { success: false, error: 'Teams integration must be active before setting a meeting organizer' };
    }

    const organizerUpn = (input.upn || '').trim() || null;
    await scopedDb.table('teams_integrations')
      .update({
        default_meeting_organizer_upn: organizerUpn,
        updated_at: new Date(),
        updated_by: user?.user_id || null,
      });

    return {
      success: true,
      data: {
        organizerUpn,
      },
    };
  } catch (error) {
    console.error('Error saving Teams meeting organizer:', error);
    const message = availabilityActionErrorMessage(error, 'Failed to save Teams meeting organizer');
    return { success: false, error: message };
  }
});

export const verifyMeetingOrganizer = withAuth(async (
  user,
  { tenant },
  input: { upn?: string | null }
): Promise<AvailabilitySettingsResult<TeamsMeetingOrganizerVerification>> => {
  try {
    const { knex: db } = await createTenantKnex();
    const canManage = await hasPermission(user, 'system_settings', 'update', db);
    if (!canManage) {
      return { success: false, error: 'Insufficient permissions to manage Teams meeting settings' };
    }

    if (!isEnterprise) {
      return { success: true, data: { valid: false, reason: 'ee_disabled' } };
    }

    if (!(await tenantHasTeamsAddOn(db, tenant))) {
      return { success: true, data: { valid: false, reason: 'addon_required' } };
    }

    const organizerUpn = (input.upn || '').trim();
    if (!organizerUpn) {
      return { success: true, data: { valid: false, reason: 'user_not_found' } };
    }

    const teamsModule = await import('@alga-psa/ee-microsoft-teams/lib');
    if (typeof teamsModule.verifyMeetingOrganizer !== 'function') {
      return { success: true, data: { valid: false, reason: 'ee_disabled' } };
    }

    const result = await teamsModule.verifyMeetingOrganizer({
      tenantId: tenant,
      organizerUpn,
    });

    return { success: true, data: result };
  } catch (error) {
    console.error('Error verifying Teams meeting organizer:', error);
    const message = availabilityActionErrorMessage(error, 'Failed to verify Teams meeting organizer');
    return { success: false, error: message };
  }
});

/**
 * Replace one technician's complete booking-availability week atomically.
 */
export const saveUserAvailabilityWeek = withAuth(async (
  user,
  { tenant },
  data: AvailabilityUserHoursWeekInput
): Promise<AvailabilitySettingsResult<IAvailabilitySetting[]>> => {
  try {
    const validatedData = availabilityUserHoursWeekSchema.parse(data);
    const { knex: db } = await createTenantKnex();
    const access = await canAccessUserHours(db, tenant, user, 'update', validatedData.user_id);
    if (!access.allowed) {
      return { success: false, error: 'Insufficient permissions to manage availability for this user' };
    }

    const saved = await withTransaction(db, async (trx: Knex.Transaction) => {
      const scopedDb = tenantDb(trx, tenant);
      const targetUser = await scopedDb.table('users')
        .where({ user_id: validatedData.user_id, user_type: 'internal', is_inactive: false })
        .forUpdate()
        .first('user_id');
      if (!targetUser) {
        throw new Error('Availability user not found');
      }

      await scopedDb.table('availability_settings')
        .where({ setting_type: 'user_hours', user_id: validatedData.user_id })
        .del();

      const now = new Date();
      await scopedDb.table('availability_settings').insert(
        validatedData.days.map((day) => ({
          availability_setting_id: uuidv4(),
          tenant,
          setting_type: 'user_hours',
          user_id: validatedData.user_id,
          service_id: null,
          day_of_week: day.day_of_week,
          start_time: day.start_time,
          end_time: day.end_time,
          is_available: day.is_available,
          buffer_before_minutes: validatedData.buffer_before_minutes,
          buffer_after_minutes: validatedData.buffer_after_minutes,
          config_json: validatedData.config_json,
          created_at: now,
          updated_at: now,
        }))
      );

      const rows = await scopedDb.table('availability_settings')
        .where({ setting_type: 'user_hours', user_id: validatedData.user_id })
        .orderBy('day_of_week');
      if (rows.length !== 7) {
        throw new Error('Availability save could not be confirmed');
      }

      return rows.map((row) => ({
        ...row,
        start_time: normalizeAvailabilityTime(row.start_time, '09:00'),
        end_time: normalizeAvailabilityTime(row.end_time, '17:00'),
      })) as IAvailabilitySetting[];
    });

    return { success: true, data: saved };
  } catch (error) {
    console.error('Error saving user availability week:', error);
    const message = availabilityActionErrorMessage(error, 'Failed to save user hours');
    return { success: false, error: message };
  }
});

/**
 * Create or update an availability setting
 * If a matching setting exists (same type, user_id, service_id, day_of_week), it will be updated
 */
export const createOrUpdateAvailabilitySetting = withAuth(async (
  user,
  { tenant },
  data: AvailabilitySettingInput & { availability_setting_id?: string }
): Promise<AvailabilitySettingsResult<IAvailabilitySetting>> => {
  try {
    // Validate input
    const validatedData = availabilitySettingSchema.parse(data);

    const { knex: db } = await createTenantKnex();

    const access = validatedData.setting_type === 'user_hours' && validatedData.user_id
      ? await canAccessUserHours(db, tenant, user, 'update', validatedData.user_id)
      : { allowed: await hasPermission(user, 'system_settings', 'update', db) };
    if (!access.allowed) {
      return { success: false, error: 'Insufficient permissions to manage availability settings' };
    }

    const result = await withTransaction(db, async (trx: Knex.Transaction) => {
      const scopedDb = tenantDb(trx, tenant);
      const now = new Date();

      // Check if updating existing setting
      if (data.availability_setting_id) {
        const existing = await scopedDb.table('availability_settings')
          .where({
            availability_setting_id: data.availability_setting_id,
            tenant
          })
          .first();

        if (!existing) {
          throw new Error('Availability setting not found');
        }

        // Update existing setting
        await scopedDb.table('availability_settings')
          .where({
            availability_setting_id: data.availability_setting_id,
            tenant
          })
          .update({
            ...validatedData,
            updated_at: now
          });

        const updated = await scopedDb.table('availability_settings')
          .where({
            availability_setting_id: data.availability_setting_id,
            tenant
          })
          .first();

        return updated as IAvailabilitySetting;
      }

      // Check for existing setting with same criteria
      let query = scopedDb.table('availability_settings')
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
        await scopedDb.table('availability_settings')
          .where({
            availability_setting_id: existing.availability_setting_id,
            tenant
          })
          .update({
            ...validatedData,
            updated_at: now
          });

        const updated = await scopedDb.table('availability_settings')
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

      await scopedDb.table('availability_settings').insert(newSetting);

      const created = await scopedDb.table('availability_settings')
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
    const message = availabilityActionErrorMessage(error, 'Failed to create/update availability setting');
    return { success: false, error: message };
  }
});

/**
 * Get availability settings with optional filters
 */
export const getAvailabilitySettings = withAuth(async (
  user,
  { tenant },
  filters?: AvailabilitySettingFilters
): Promise<AvailabilitySettingsResult<IAvailabilitySetting[]>> => {
  try {
    const { knex: db } = await createTenantKnex();

    const access = await canAccessUserHours(db, tenant, user, 'read', filters?.user_id ?? undefined);
    if (!access.hasSystemAccess && filters?.setting_type && filters.setting_type !== 'user_hours') {
      return { success: false, error: 'Insufficient permissions to view availability settings' };
    }
    if (!access.allowed) return { success: false, error: 'Insufficient permissions to view availability settings' };

    const settings = await withTransaction(db, async (trx: Knex.Transaction) => {
      const scopedDb = tenantDb(trx, tenant);
      let query = scopedDb.table('availability_settings')
        .orderBy('created_at', 'desc');

      if (!access.hasSystemAccess) {
        query = query.where({ setting_type: 'user_hours' })
          .whereIn('user_id', Array.from(access.scopedUserIds));
      }

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
    const message = availabilityActionErrorMessage(error, 'Failed to fetch availability settings');
    return { success: false, error: message };
  }
});

/**
 * Delete an availability setting
 */
export const deleteAvailabilitySetting = withAuth(async (
  user,
  { tenant },
  settingId: string
): Promise<AvailabilitySettingsResult<void>> => {
  try {
    const { knex: db } = await createTenantKnex();

    await withTransaction(db, async (trx: Knex.Transaction) => {
      const scopedDb = tenantDb(trx, tenant);
      const setting = await scopedDb.table('availability_settings')
        .where({
          availability_setting_id: settingId,
          tenant
        })
        .first();

      if (!setting) {
        throw new Error('Availability setting not found');
      }

      const access = setting.setting_type === 'user_hours' && setting.user_id
        ? await canAccessUserHours(trx, tenant, user, 'delete', setting.user_id)
        : { allowed: await hasPermission(user, 'system_settings', 'delete', trx) };
      if (!access.allowed) {
        throw new Error('Insufficient permissions to delete availability settings');
      }

      await scopedDb.table('availability_settings')
        .where({
          availability_setting_id: settingId,
          tenant
        })
        .del();
    });

    return { success: true };
  } catch (error) {
    console.error('Error deleting availability setting:', error);
    const message = availabilityActionErrorMessage(error, 'Failed to delete availability setting');
    return { success: false, error: message };
  }
});

/**
 * Add an availability exception (holiday, time off, etc.)
 */
export const addAvailabilityException = withAuth(async (
  user,
  { tenant },
  data: AvailabilityExceptionInput
): Promise<AvailabilitySettingsResult<IAvailabilityException>> => {
  try {
    // Validate input
    const validatedData = availabilityExceptionSchema.parse(data);

    const { knex: db } = await createTenantKnex();

    // Check permissions
    const canManage = await hasPermission(user, 'system_settings', 'update', db);
    if (!canManage) {
      return { success: false, error: 'Insufficient permissions to manage availability exceptions' };
    }

    const exception = await withTransaction(db, async (trx: Knex.Transaction) => {
      const scopedDb = tenantDb(trx, tenant);
      const now = new Date();

      // Check if exception already exists for this user/date
      let query = scopedDb.table('availability_exceptions')
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
        await scopedDb.table('availability_exceptions')
          .where({
            exception_id: existing.exception_id,
            tenant
          })
          .update({
            is_available: validatedData.is_available,
            reason: validatedData.reason,
            updated_at: now
          });

        const updated = await scopedDb.table('availability_exceptions')
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

      await scopedDb.table('availability_exceptions').insert(newException);

      const created = await scopedDb.table('availability_exceptions')
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
    const message = availabilityActionErrorMessage(error, 'Failed to add availability exception');
    return { success: false, error: message };
  }
});

/**
 * Get availability exceptions with optional filters
 */
export const getAvailabilityExceptions = withAuth(async (
  user,
  { tenant },
  userId?: string,
  dateRange?: { from: string; to: string }
): Promise<AvailabilitySettingsResult<IAvailabilityException[]>> => {
  try {
    const { knex: db } = await createTenantKnex();

    // Check permissions
    const canRead = await hasPermission(user, 'system_settings', 'read', db);
    if (!canRead) {
      return { success: false, error: 'Insufficient permissions to view availability exceptions' };
    }

    const exceptions = await withTransaction(db, async (trx: Knex.Transaction) => {
      const scopedDb = tenantDb(trx, tenant);
      let query = scopedDb.table('availability_exceptions')
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
    const message = availabilityActionErrorMessage(error, 'Failed to fetch availability exceptions');
    return { success: false, error: message };
  }
});

/**
 * Delete an availability exception
 */
export const deleteAvailabilityException = withAuth(async (
  user,
  { tenant },
  exceptionId: string
): Promise<AvailabilitySettingsResult<void>> => {
  try {
    const { knex: db } = await createTenantKnex();

    // Check permissions
    const canDelete = await hasPermission(user, 'system_settings', 'delete', db);
    if (!canDelete) {
      return { success: false, error: 'Insufficient permissions to delete availability exceptions' };
    }

    await withTransaction(db, async (trx: Knex.Transaction) => {
      const scopedDb = tenantDb(trx, tenant);
      const exception = await scopedDb.table('availability_exceptions')
        .where({
          exception_id: exceptionId,
          tenant
        })
        .first();

      if (!exception) {
        throw new Error('Availability exception not found');
      }

      await scopedDb.table('availability_exceptions')
        .where({
          exception_id: exceptionId,
          tenant
        })
        .del();
    });

    return { success: true };
  } catch (error) {
    console.error('Error deleting availability exception:', error);
    const message = availabilityActionErrorMessage(error, 'Failed to delete availability exception');
    return { success: false, error: message };
  }
});
