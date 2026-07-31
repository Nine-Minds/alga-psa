import { getAdminConnection } from '@alga-psa/db/admin.js';
import { resumeTenant, suspendTenant } from '@alga-psa/db';

/**
 * Stamp the tenant-wide suspension flag (tenants.suspended_at). Errors are
 * contained: suspension gates are additive protection and must never strand
 * the deletion workflow.
 */
export async function suspendTenantBackgroundActivity(
  tenantId: string
): Promise<{ suspended: boolean }> {
  try {
    const knex = await getAdminConnection();
    const suspended = await suspendTenant(knex, tenantId, 'tenant_cancelled');
    return { suspended };
  } catch (error) {
    console.warn('[TenantDeletion] Failed to suspend tenant background activity', {
      tenantId,
      error: error instanceof Error ? error.message : String(error),
    });
    return { suspended: false };
  }
}

/**
 * Clear a cancellation-owned suspension. Failures propagate so Temporal
 * retries — silently returning would strand a won-back tenant suspended.
 */
export async function resumeTenantBackgroundActivity(
  tenantId: string
): Promise<{ resumed: boolean }> {
  const knex = await getAdminConnection();
  const resumed = await resumeTenant(knex, tenantId, 'tenant_cancelled');
  return { resumed };
}
