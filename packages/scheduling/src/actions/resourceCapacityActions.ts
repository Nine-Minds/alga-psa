'use server';

import { createTenantKnex, tenantDb, withTransaction } from '@alga-psa/db';
import { Knex } from 'knex';
import { withAuth, hasPermission } from '@alga-psa/auth';
import { v4 as uuidv4 } from 'uuid';

export interface UserCapacityResult {
  success: boolean;
  data?: { userId: string; maxWeeklyCapacity: number | null };
  error?: string;
}

function normalizeCapacity(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return Math.round(parsed);
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
        maxWeeklyCapacity: row ? normalizeCapacity(row.max_weekly_capacity) : null,
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
 * on Citus, so we select-then-insert/update rather than relying on onConflict,
 * and avoid db.fn.now() inside a merge (IMMUTABLE-upsert landmine).
 */
export const updateUserCapacity = withAuth(async (
  user,
  { tenant },
  userId: string,
  maxWeeklyCapacity: number | null
): Promise<UserCapacityResult> => {
  try {
    const { knex: db } = await createTenantKnex();
    if (!(await hasPermission(user, 'user', 'update', db))) {
      return { success: false, error: 'Insufficient permissions to update user capacity' };
    }

    const capacity = normalizeCapacity(maxWeeklyCapacity);

    await withTransaction(db, async (trx: Knex.Transaction) => {
      const scopedDb = tenantDb(trx, tenant);
      const now = new Date();
      const existing = await scopedDb.table('resources')
        .where({ user_id: userId })
        .first('resource_id');

      if (existing) {
        await scopedDb.table('resources')
          .where({ resource_id: existing.resource_id })
          .update({ max_weekly_capacity: capacity, updated_at: now });
      } else {
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
