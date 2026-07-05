'use server';

import { headers } from 'next/headers.js';
import { getLicenseUsage, type LicenseUsage } from '../lib/get-license-usage';
import { isSelfHostLicensing } from '../lib/license-state';
import { getConnection, getTenantContext, tenantDb } from '@alga-psa/db';

/**
 * Resolve the current request's tenant from the async tenant context, falling
 * back to the `x-tenant-id` header. Inlined here (rather than imported from
 * `@alga-psa/tenancy`) to keep `@alga-psa/licensing` off the tenancy package:
 * `auth` imports `@alga-psa/licensing`, and `tenancy → user-composition → auth`,
 * so depending on tenancy would close an nx build cycle
 * (auth→licensing→tenancy→user-composition→auth) that breaks the EE image build.
 * `getTenantContext` already comes from `@alga-psa/db`, an existing dependency.
 */
async function getTenantForCurrentRequest(): Promise<string | null> {
  const contextTenant = getTenantContext() ?? null;
  if (contextTenant) {
    return contextTenant;
  }
  const headerValues = await headers();
  return headerValues.get('x-tenant-id') ?? null;
}

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

  const result = await tenantDb(knex, tenantId).table('users')
    .where({
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

/**
 * Client-callable check for whether this install is self-host/on-prem (a
 * `license_state` row is present). Used by the UI to route account/billing to
 * the Nine Minds client portal on-prem instead of the in-app Stripe pages.
 */
export async function isSelfHostLicensingAction(): Promise<boolean> {
  return isSelfHostLicensing();
}
