'use server';

import { getLicenseUsage, type LicenseUsage } from '@server/lib/license/get-license-usage';
import { getSession } from '@server/lib/auth/getSession';
import { getConnection } from '@server/lib/db/db';

/**
 * Server action to get the current license usage for the session tenant
 * @returns License usage information or error
 */
export async function getLicenseUsageAction(): Promise<{
  success: boolean;
  data?: LicenseUsage;
  error?: string
}> {
  try {
    const session = await getSession();

    if (!session?.user?.tenant) {
      return {
        success: false,
        error: 'No tenant in session'
      };
    }

    const usage = await getLicenseUsage(session.user.tenant);

    return {
      success: true,
      data: usage,
    };
  } catch (error) {
    console.error('Error getting license usage:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to get license usage',
    };
  }
}

/**
 * Get count of active (non-deactivated) internal users for a tenant
 * Used for validating license reductions
 */
export async function getActiveUserCount(tenantId: string): Promise<number> {
  const knex = await getConnection(tenantId);

  const result = await knex('users')
    .where({
      tenant: tenantId,
      user_type: 'internal',
      is_inactive: false
    })
    .count('user_id as count')
    .first();

  return parseInt(result?.count as string || '0', 10);
}

/**
 * Server action to get active user count for the session tenant
 * @returns Active user count or error
 */
export async function getActiveUserCountAction(): Promise<{
  success: boolean;
  data?: number;
  error?: string;
}> {
  try {
    const session = await getSession();

    if (!session?.user?.tenant) {
      return {
        success: false,
        error: 'No tenant in session'
      };
    }

    const count = await getActiveUserCount(session.user.tenant);

    return {
      success: true,
      data: count,
    };
  } catch (error) {
    console.error('Error getting active user count:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to get active user count',
    };
  }
}
