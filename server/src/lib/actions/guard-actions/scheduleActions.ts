'use server';

import { createTenantKnex } from '../../db';
import { withTransaction } from '@alga-psa/shared/db';
import { getCurrentUser } from '../user-actions/userActions';
import { hasPermission } from '../../auth/rbac';
import { Knex } from 'knex';
import {
  IGuardSchedule,
  IGuardScheduleWithTarget,
  ICreateScheduleRequest,
  IUpdateScheduleRequest,
  IGuardScheduleListParams,
  IGuardSchedulePaginatedResponse,
  DEFAULT_TIMEZONE,
  MIN_DAY_OF_MONTH,
  MAX_DAY_OF_MONTH,
} from '../../../interfaces/guard/schedule.interfaces';
import {
  validateTimeFormat,
  validateDayOfMonth,
  calculateNextRunAt,
} from './scheduleUtils';

/**
 * Get all schedules with pagination
 */
export async function getSchedules(
  params: IGuardScheduleListParams = {}
): Promise<IGuardSchedulePaginatedResponse<IGuardScheduleWithTarget>> {
  const { knex: db, tenant } = await createTenantKnex();
  const currentUser = await getCurrentUser();

  if (!currentUser) {
    throw new Error('No authenticated user found');
  }

  const canView = await hasPermission(currentUser, 'guard:schedules', 'manage');
  if (!canView) {
    throw new Error('Permission denied: guard:schedules:manage');
  }

  const {
    page = 1,
    page_size = 20,
    sort_by = 'next_run_at',
    sort_order = 'asc',
    schedule_type,
    enabled,
  } = params;

  return withTransaction(db, async (trx: Knex.Transaction) => {
    let query = trx('guard_schedules')
      .where({ tenant });

    // Apply filters
    if (schedule_type) {
      query = query.where('schedule_type', schedule_type);
    }

    if (enabled !== undefined) {
      query = query.where('enabled', enabled);
    }

    // Get total count
    const countResult = await query.clone()
      .count('id as count')
      .first();
    const total = parseInt(countResult?.count as string || '0', 10);

    // Apply pagination and sorting
    const offset = (page - 1) * page_size;
    const schedules = await query
      .orderBy(sort_by, sort_order)
      .limit(page_size)
      .offset(offset);

    // Fetch target names for each schedule
    const schedulesWithTargets = await Promise.all(
      schedules.map(async (schedule: IGuardSchedule) => {
        let target_name = 'Unknown';

        if (schedule.schedule_type === 'pii_scan') {
          const profile = await trx('guard_pii_profiles')
            .where({ tenant, id: schedule.target_id })
            .select('name')
            .first();
          target_name = profile?.name || 'Deleted Profile';
        } else if (schedule.schedule_type === 'asm_scan') {
          const domain = await trx('guard_asm_domains')
            .where({ tenant, id: schedule.target_id })
            .select('domain_name')
            .first();
          target_name = domain?.domain_name || 'Deleted Domain';
        }

        return { ...schedule, target_name };
      })
    );

    return {
      data: schedulesWithTargets as IGuardScheduleWithTarget[],
      total,
      page,
      page_size,
      total_pages: Math.ceil(total / page_size),
    };
  });
}

/**
 * Get a single schedule by ID
 */
export async function getSchedule(id: string): Promise<IGuardScheduleWithTarget | null> {
  const { knex: db, tenant } = await createTenantKnex();
  const currentUser = await getCurrentUser();

  if (!currentUser) {
    throw new Error('No authenticated user found');
  }

  const canView = await hasPermission(currentUser, 'guard:schedules', 'manage');
  if (!canView) {
    throw new Error('Permission denied: guard:schedules:manage');
  }

  return withTransaction(db, async (trx: Knex.Transaction) => {
    const schedule = await trx('guard_schedules')
      .where({ tenant, id })
      .first();

    if (!schedule) {
      return null;
    }

    let target_name = 'Unknown';

    if (schedule.schedule_type === 'pii_scan') {
      const profile = await trx('guard_pii_profiles')
        .where({ tenant, id: schedule.target_id })
        .select('name')
        .first();
      target_name = profile?.name || 'Deleted Profile';
    } else if (schedule.schedule_type === 'asm_scan') {
      const domain = await trx('guard_asm_domains')
        .where({ tenant, id: schedule.target_id })
        .select('domain_name')
        .first();
      target_name = domain?.domain_name || 'Deleted Domain';
    }

    return { ...schedule, target_name } as IGuardScheduleWithTarget;
  });
}

/**
 * Create a new schedule
 */
export async function createSchedule(
  data: ICreateScheduleRequest
): Promise<IGuardSchedule> {
  const { knex: db, tenant } = await createTenantKnex();
  const currentUser = await getCurrentUser();

  if (!currentUser) {
    throw new Error('No authenticated user found');
  }

  const canManage = await hasPermission(currentUser, 'guard:schedules', 'manage');
  if (!canManage) {
    throw new Error('Permission denied: guard:schedules:manage');
  }

  // Validate time format
  if (!validateTimeFormat(data.time_of_day)) {
    throw new Error('Invalid time format. Use HH:MM (24-hour format)');
  }

  // Validate frequency-specific fields
  if (data.frequency === 'weekly' && !data.day_of_week) {
    throw new Error('day_of_week is required for weekly schedules');
  }

  if (data.frequency === 'monthly') {
    if (!data.day_of_month) {
      throw new Error('day_of_month is required for monthly schedules');
    }
    if (!validateDayOfMonth(data.day_of_month)) {
      throw new Error(`day_of_month must be between ${MIN_DAY_OF_MONTH} and ${MAX_DAY_OF_MONTH}`);
    }
  }

  return withTransaction(db, async (trx: Knex.Transaction) => {
    // Verify target exists
    if (data.schedule_type === 'pii_scan') {
      const profile = await trx('guard_pii_profiles')
        .where({ tenant, id: data.target_id })
        .first();
      if (!profile) {
        throw new Error('Target PII profile not found');
      }
    } else if (data.schedule_type === 'asm_scan') {
      const domain = await trx('guard_asm_domains')
        .where({ tenant, id: data.target_id })
        .first();
      if (!domain) {
        throw new Error('Target ASM domain not found');
      }
    }

    const timezone = data.timezone || DEFAULT_TIMEZONE;
    const enabled = data.enabled !== undefined ? data.enabled : true;

    // Calculate next run time
    const next_run_at = enabled
      ? calculateNextRunAt(
          data.frequency,
          data.time_of_day,
          timezone,
          data.day_of_week,
          data.day_of_month
        )
      : null;

    const [schedule] = await trx('guard_schedules')
      .insert({
        tenant,
        name: data.name,
        description: data.description,
        schedule_type: data.schedule_type,
        frequency: data.frequency,
        day_of_week: data.day_of_week || null,
        day_of_month: data.day_of_month || null,
        time_of_day: data.time_of_day,
        timezone,
        target_id: data.target_id,
        enabled,
        next_run_at,
        created_at: new Date(),
        updated_at: new Date(),
        created_by: currentUser.user_id,
      })
      .returning('*');

    // Log audit event
    await trx('guard_audit_log').insert({
      tenant,
      user_id: currentUser.user_id,
      action: 'schedule_created',
      resource_type: 'guard_schedule',
      resource_id: schedule.id,
      details: JSON.stringify({
        name: data.name,
        schedule_type: data.schedule_type,
        frequency: data.frequency,
        target_id: data.target_id,
      }),
      created_at: new Date(),
    });

    return schedule;
  });
}

/**
 * Update a schedule
 */
export async function updateSchedule(
  id: string,
  data: IUpdateScheduleRequest
): Promise<IGuardSchedule> {
  const { knex: db, tenant } = await createTenantKnex();
  const currentUser = await getCurrentUser();

  if (!currentUser) {
    throw new Error('No authenticated user found');
  }

  const canManage = await hasPermission(currentUser, 'guard:schedules', 'manage');
  if (!canManage) {
    throw new Error('Permission denied: guard:schedules:manage');
  }

  // Validate time format if provided
  if (data.time_of_day && !validateTimeFormat(data.time_of_day)) {
    throw new Error('Invalid time format. Use HH:MM (24-hour format)');
  }

  // Validate day of month if provided
  if (data.day_of_month !== undefined && !validateDayOfMonth(data.day_of_month)) {
    throw new Error(`day_of_month must be between ${MIN_DAY_OF_MONTH} and ${MAX_DAY_OF_MONTH}`);
  }

  return withTransaction(db, async (trx: Knex.Transaction) => {
    // Check schedule exists
    const existing = await trx('guard_schedules')
      .where({ tenant, id })
      .first();

    if (!existing) {
      throw new Error('Schedule not found');
    }

    // Verify target exists if changing
    if (data.target_id && data.target_id !== existing.target_id) {
      if (existing.schedule_type === 'pii_scan') {
        const profile = await trx('guard_pii_profiles')
          .where({ tenant, id: data.target_id })
          .first();
        if (!profile) {
          throw new Error('Target PII profile not found');
        }
      } else if (existing.schedule_type === 'asm_scan') {
        const domain = await trx('guard_asm_domains')
          .where({ tenant, id: data.target_id })
          .first();
        if (!domain) {
          throw new Error('Target ASM domain not found');
        }
      }
    }

    // Merge updates
    const frequency = data.frequency || existing.frequency;
    const time_of_day = data.time_of_day || existing.time_of_day;
    const timezone = data.timezone || existing.timezone;
    const day_of_week = data.day_of_week !== undefined ? data.day_of_week : existing.day_of_week;
    const day_of_month = data.day_of_month !== undefined ? data.day_of_month : existing.day_of_month;
    const enabled = data.enabled !== undefined ? data.enabled : existing.enabled;

    // Validate frequency-specific fields after merge
    if (frequency === 'weekly' && !day_of_week) {
      throw new Error('day_of_week is required for weekly schedules');
    }

    if (frequency === 'monthly' && !day_of_month) {
      throw new Error('day_of_month is required for monthly schedules');
    }

    // Calculate next run time
    const next_run_at = enabled
      ? calculateNextRunAt(
          frequency,
          time_of_day,
          timezone,
          day_of_week,
          day_of_month
        )
      : null;

    const updateData: Record<string, unknown> = {
      updated_at: new Date(),
    };

    if (data.name !== undefined) updateData.name = data.name;
    if (data.description !== undefined) updateData.description = data.description;
    if (data.frequency !== undefined) updateData.frequency = data.frequency;
    if (data.day_of_week !== undefined) updateData.day_of_week = data.day_of_week;
    if (data.day_of_month !== undefined) updateData.day_of_month = data.day_of_month;
    if (data.time_of_day !== undefined) updateData.time_of_day = data.time_of_day;
    if (data.timezone !== undefined) updateData.timezone = data.timezone;
    if (data.target_id !== undefined) updateData.target_id = data.target_id;
    if (data.enabled !== undefined) updateData.enabled = data.enabled;

    // Always update next_run_at when schedule parameters change
    updateData.next_run_at = next_run_at;

    const [schedule] = await trx('guard_schedules')
      .where({ tenant, id })
      .update(updateData)
      .returning('*');

    // Log audit event
    await trx('guard_audit_log').insert({
      tenant,
      user_id: currentUser.user_id,
      action: 'schedule_updated',
      resource_type: 'guard_schedule',
      resource_id: id,
      details: JSON.stringify({
        changes: data,
      }),
      created_at: new Date(),
    });

    return schedule;
  });
}

/**
 * Delete a schedule
 */
export async function deleteSchedule(id: string): Promise<void> {
  const { knex: db, tenant } = await createTenantKnex();
  const currentUser = await getCurrentUser();

  if (!currentUser) {
    throw new Error('No authenticated user found');
  }

  const canManage = await hasPermission(currentUser, 'guard:schedules', 'manage');
  if (!canManage) {
    throw new Error('Permission denied: guard:schedules:manage');
  }

  return withTransaction(db, async (trx: Knex.Transaction) => {
    const existing = await trx('guard_schedules')
      .where({ tenant, id })
      .first();

    if (!existing) {
      throw new Error('Schedule not found');
    }

    await trx('guard_schedules')
      .where({ tenant, id })
      .delete();

    // Log audit event
    await trx('guard_audit_log').insert({
      tenant,
      user_id: currentUser.user_id,
      action: 'schedule_deleted',
      resource_type: 'guard_schedule',
      resource_id: id,
      details: JSON.stringify({
        name: existing.name,
        schedule_type: existing.schedule_type,
      }),
      created_at: new Date(),
    });
  });
}

/**
 * Toggle schedule enabled status
 */
export async function toggleScheduleEnabled(id: string): Promise<IGuardSchedule> {
  const { knex: db, tenant } = await createTenantKnex();
  const currentUser = await getCurrentUser();

  if (!currentUser) {
    throw new Error('No authenticated user found');
  }

  const canManage = await hasPermission(currentUser, 'guard:schedules', 'manage');
  if (!canManage) {
    throw new Error('Permission denied: guard:schedules:manage');
  }

  return withTransaction(db, async (trx: Knex.Transaction) => {
    const existing = await trx('guard_schedules')
      .where({ tenant, id })
      .first();

    if (!existing) {
      throw new Error('Schedule not found');
    }

    const newEnabled = !existing.enabled;

    // Calculate next run time if enabling
    const next_run_at = newEnabled
      ? calculateNextRunAt(
          existing.frequency,
          existing.time_of_day,
          existing.timezone,
          existing.day_of_week,
          existing.day_of_month
        )
      : null;

    const [schedule] = await trx('guard_schedules')
      .where({ tenant, id })
      .update({
        enabled: newEnabled,
        next_run_at,
        updated_at: new Date(),
      })
      .returning('*');

    // Log audit event
    await trx('guard_audit_log').insert({
      tenant,
      user_id: currentUser.user_id,
      action: newEnabled ? 'schedule_enabled' : 'schedule_disabled',
      resource_type: 'guard_schedule',
      resource_id: id,
      details: JSON.stringify({
        name: existing.name,
      }),
      created_at: new Date(),
    });

    return schedule;
  });
}

/**
 * Update next_run_at after schedule execution
 * (Called by the scheduler job handler)
 */
export async function updateScheduleAfterExecution(
  scheduleId: string,
  executionTime: Date = new Date()
): Promise<void> {
  const { knex: db, tenant } = await createTenantKnex();

  if (!tenant) {
    throw new Error('Tenant context required');
  }

  return withTransaction(db, async (trx: Knex.Transaction) => {
    const schedule = await trx('guard_schedules')
      .where({ tenant, id: scheduleId })
      .first();

    if (!schedule || !schedule.enabled) {
      return;
    }

    // Calculate next run time from now
    const next_run_at = calculateNextRunAt(
      schedule.frequency,
      schedule.time_of_day,
      schedule.timezone,
      schedule.day_of_week,
      schedule.day_of_month,
      executionTime
    );

    await trx('guard_schedules')
      .where({ tenant, id: scheduleId })
      .update({
        last_run_at: executionTime,
        next_run_at,
        updated_at: new Date(),
      });
  });
}

/**
 * Get schedules due for execution
 * (Called by the scheduler cron job)
 */
export async function getSchedulesDueForExecution(): Promise<IGuardSchedule[]> {
  const { knex: db, tenant } = await createTenantKnex();

  if (!tenant) {
    throw new Error('Tenant context required');
  }

  return withTransaction(db, async (trx: Knex.Transaction) => {
    const now = new Date();

    const schedules = await trx('guard_schedules')
      .where({ tenant, enabled: true })
      .where('next_run_at', '<=', now)
      .select('*');

    return schedules;
  });
}
