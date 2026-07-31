import type { Knex } from 'knex';
import { tenantDb } from './tenantDb';

export type TenantSuspensionReason = 'tenant_cancelled';

const SUSPENSION_LOOKUP_TENANT = '__tenant_suspension_lookup__';

function tenantsTable(knex: Knex, reason: string) {
  return tenantDb(knex, SUSPENSION_LOOKUP_TENANT).unscoped<{
    tenant: string;
    suspended_at: string | Date | null;
    suspended_reason: TenantSuspensionReason | null;
  }>('tenants', reason);
}

/**
 * Whether the tenant is suspended (background activity gated).
 *
 * Fails open: gates using this protect a handful of cancelled tenants, so a
 * flag-read error must degrade to "not suspended" rather than halt active
 * tenants' work.
 */
export async function isTenantSuspended(knex: Knex, tenantId: string): Promise<boolean> {
  try {
    const row = await tenantsTable(knex, 'tenant suspension gate lookup')
      .where({ tenant: tenantId })
      .first('suspended_at');
    return Boolean(row?.suspended_at);
  } catch (error) {
    console.warn('[TenantSuspension] lookup failed; treating tenant as not suspended', {
      tenantId,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

/**
 * Stamp the suspension flag. Idempotent: an already-suspended tenant keeps
 * its original timestamp and reason.
 */
export async function suspendTenant(
  knex: Knex,
  tenantId: string,
  reason: TenantSuspensionReason
): Promise<boolean> {
  const updated = await tenantsTable(knex, 'tenant suspension stamp')
    .where({ tenant: tenantId })
    .whereNull('suspended_at')
    .update({ suspended_at: knex.fn.now(), suspended_reason: reason });
  return Number(updated) > 0;
}

/**
 * Clear the suspension flag, but only when the stored reason matches — a
 * future manual suspension must survive a cancellation rollback.
 */
export async function resumeTenant(
  knex: Knex,
  tenantId: string,
  reason: TenantSuspensionReason
): Promise<boolean> {
  const updated = await tenantsTable(knex, 'tenant suspension clear')
    .where({ tenant: tenantId, suspended_reason: reason })
    .whereNotNull('suspended_at')
    .update({ suspended_at: null, suspended_reason: null });
  return Number(updated) > 0;
}
