'use server';

import { createTenantKnex, tenantDb, withTransaction } from '@alga-psa/db';
import { Knex } from 'knex';
import { withAuth, hasPermission } from '@alga-psa/auth';
import { v4 as uuidv4 } from 'uuid';
import { parseWeeklyCapacityHours, weeklyCapacityRejectionMessage } from '../lib/resourceCapacity';
import {
  parseWorkSchedule,
  workScheduleRejectionMessage,
  type WorkScheduleDay,
} from '../lib/workSchedule';

export interface UserCapacityResult {
  success: boolean;
  data?: { userId: string; maxWeeklyCapacity: number | null };
  error?: string;
}

export interface UserWorkScheduleResult {
  success: boolean;
  data?: { userId: string; days: WorkScheduleDay[] };
  error?: string;
}

function storedCapacity(value: unknown): number | null {
  const parsed = parseWeeklyCapacityHours(value);
  return parsed.ok ? parsed.value : null;
}

/**
 * Read the weekly capacity (hours) for a user from the resources row.
 */
export const getUserCapacity = withAuth(async (
  user,
  { tenant },
  userId: string
): Promise<UserCapacityResult> => {
  try {
    const { knex: db } = await createTenantKnex();
    if (!(await hasPermission(user, 'user', 'read', db))) {
      return { success: false, error: 'Insufficient permissions to view user capacity' };
    }

    const row = await tenantDb(db, tenant).table('resources')
      .where({ user_id: userId })
      .first('max_weekly_capacity');

    return {
      success: true,
      data: {
        userId,
        maxWeeklyCapacity: row ? storedCapacity(row.max_weekly_capacity) : null,
      },
    };
  } catch (error) {
    console.error('Error loading user capacity:', error);
    return { success: false, error: 'Failed to load user capacity' };
  }
});

/**
 * Create or update the weekly capacity (hours) for a user.
 *
 * The resources table PK is (tenant, resource_id) and the table is distributed
 * on Citus, so we update-then-insert rather than relying on onConflict, and
 * avoid db.fn.now() inside a merge (IMMUTABLE-upsert landmine). A unique index
 * on (tenant, user_id) keeps this to a single row per user; the update matches
 * on user_id so it stays correct for rows predating that index.
 */
export const updateUserCapacity = withAuth(async (
  user,
  { tenant },
  userId: string,
  maxWeeklyCapacity: number | string | null
): Promise<UserCapacityResult> => {
  try {
    const parsed = parseWeeklyCapacityHours(maxWeeklyCapacity);
    if (!parsed.ok) {
      return { success: false, error: weeklyCapacityRejectionMessage(parsed.reason) };
    }
    const capacity = parsed.value;

    const { knex: db } = await createTenantKnex();
    if (!(await hasPermission(user, 'user', 'update', db))) {
      return { success: false, error: 'Insufficient permissions to update user capacity' };
    }

    await withTransaction(db, async (trx: Knex.Transaction) => {
      const scopedDb = tenantDb(trx, tenant);
      const now = new Date();
      const updated = await scopedDb.table('resources')
        .where({ user_id: userId })
        .update({ max_weekly_capacity: capacity, updated_at: now });

      if (!updated) {
        await scopedDb.table('resources').insert({
          tenant,
          resource_id: uuidv4(),
          user_id: userId,
          max_weekly_capacity: capacity,
          created_at: now,
          updated_at: now,
        });
      }
    });

    return { success: true, data: { userId, maxWeeklyCapacity: capacity } };
  } catch (error) {
    console.error('Error updating user capacity:', error);
    return { success: false, error: 'Failed to update user capacity' };
  }
});

/**
 * Read a user's weekly work schedule (when they are on the clock).
 *
 * Distinct from `availability_settings`, which controls client bookability.
 */
export const getUserWorkSchedule = withAuth(async (
  user,
  { tenant },
  userId: string
): Promise<UserWorkScheduleResult> => {
  try {
    const { knex: db } = await createTenantKnex();
    if (!(await hasPermission(user, 'user', 'read', db))) {
      return { success: false, error: 'Insufficient permissions to view work schedules' };
    }

    const rows = await tenantDb(db, tenant).table('user_work_schedules')
      .where({ user_id: userId })
      .orderBy('day_of_week')
      .select('day_of_week', 'start_time', 'end_time', 'is_working');

    return {
      success: true,
      data: {
        userId,
        days: rows.map((row: any) => ({
          dayOfWeek: Number(row.day_of_week) as WorkScheduleDay['dayOfWeek'],
          isWorking: Boolean(row.is_working),
          startTime: String(row.start_time).slice(0, 5),
          endTime: String(row.end_time).slice(0, 5),
        })),
      },
    };
  } catch (error) {
    console.error('Error loading user work schedule:', error);
    return { success: false, error: 'Failed to load work schedule' };
  }
});

/**
 * Replace a user's weekly work schedule.
 *
 * Delete-then-insert inside one transaction: the schedule is a whole-week
 * document, so a partial upsert could leave a stale day behind that silently
 * keeps contributing capacity. Passing an empty array clears the schedule and
 * hands the report back to the weekly-capacity fallback.
 */
export const updateUserWorkSchedule = withAuth(async (
  user,
  { tenant },
  userId: string,
  days: WorkScheduleDay[]
): Promise<UserWorkScheduleResult> => {
  try {
    const parsed = parseWorkSchedule(days);
    if (!parsed.ok) {
      return { success: false, error: workScheduleRejectionMessage(parsed.reason) };
    }

    const { knex: db } = await createTenantKnex();
    if (!(await hasPermission(user, 'user', 'update', db))) {
      return { success: false, error: 'Insufficient permissions to update work schedules' };
    }

    await withTransaction(db, async (trx: Knex.Transaction) => {
      const scopedDb = tenantDb(trx, tenant);
      await scopedDb.table('user_work_schedules').where({ user_id: userId }).delete();

      if (parsed.value.length > 0) {
        const now = new Date();
        await scopedDb.table('user_work_schedules').insert(
          parsed.value.map((day) => ({
            tenant,
            user_id: userId,
            day_of_week: day.dayOfWeek,
            start_time: day.startTime,
            end_time: day.endTime,
            is_working: day.isWorking,
            created_at: now,
            updated_at: now,
          })),
        );
      }
    });

    return { success: true, data: { userId, days: parsed.value } };
  } catch (error) {
    console.error('Error updating user work schedule:', error);
    return { success: false, error: 'Failed to update work schedule' };
  }
});
