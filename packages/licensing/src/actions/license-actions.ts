'use server';

import { getLicenseUsage, type LicenseUsage } from '../lib/get-license-usage';
import { getConnection } from '@alga-psa/db';
import { getTenantForCurrentRequest } from '@alga-psa/tenancy/server';

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
    const tenant = await getTenantForCurrentRequest();

    if (!tenant) {
      return {
        success: false,
        error: 'No tenant in request'
      };
    }

    const usage = await getLicenseUsage(tenant);

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
    const tenant = await getTenantForCurrentRequest();

    if (!tenant) {
      return {
        success: false,
        error: 'No tenant in request'
      };
    }

    const count = await getActiveUserCount(tenant);

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
