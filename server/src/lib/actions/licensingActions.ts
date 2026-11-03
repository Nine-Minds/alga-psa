'use server';

import { withAuth, type AuthContext } from '@alga-psa/auth/withAuth';
import type { IUserWithRoles } from '@alga-psa/types';
import { getConnection, tenantDb } from '@alga-psa/db';
import { getLicenseUsage, type LicenseUsage } from '@alga-psa/licensing';

/** Read license usage for the authenticated tenant. */
export const getLicenseUsageAction = withAuth(async (
  _user: IUserWithRoles,
  { tenant }: AuthContext
): Promise<{ success: boolean; data?: LicenseUsage; error?: string }> => {
  try {
    return { success: true, data: await getLicenseUsage(tenant) };
  } catch (error) {
    console.error('Error getting license usage:', error);
    return { success: false, error: 'Failed to get license usage' };
  }
});

/** Read the active internal-user count for the authenticated tenant. */
export const getActiveUserCountAction = withAuth(async (
  _user: IUserWithRoles,
  { tenant }: AuthContext
): Promise<{ success: boolean; data?: number; error?: string }> => {
  try {
    const knex = await getConnection(tenant);
    const result = await tenantDb(knex, tenant).table('users')
      .where({ user_type: 'internal', is_inactive: false })
      .count('user_id as count')
      .first();
    return { success: true, data: parseInt(result?.count as string || '0', 10) };
  } catch (error) {
    console.error('Error getting active user count:', error);
    return { success: false, error: 'Failed to get active user count' };
  }
});
