import { getAdminConnection } from '@alga-psa/db/admin';
import { tenantDb } from '@alga-psa/db';

/**
 * Tenant discovery for the Stripe payments webhook. The webhook has no session,
 * so it reads payment_provider_configs across tenants with an explicit,
 * documented unscoped query (same pattern as the license-order handler).
 */
const DISCOVERY_SCOPE = '__stripe_payment_webhook_tenant_discovery__';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isTenantIdShape(value: string): boolean {
  return UUID_RE.test(value);
}

/** Every tenant with an enabled Stripe payment provider config. */
export async function listEnabledStripeTenants(): Promise<string[]> {
  const knex = await getAdminConnection();
  const rows = await tenantDb(knex, DISCOVERY_SCOPE)
    .unscoped('payment_provider_configs', 'enumerate enabled Stripe tenants for webhook signature selection')
    .where({ provider_type: 'stripe', is_enabled: true })
    .select('tenant');
  return Array.from(new Set(rows.map((r: { tenant: string }) => r.tenant)));
}

/** True when the tenant exists with an enabled Stripe payment provider config. */
export async function isStripeTenantEnabled(tenantId: string): Promise<boolean> {
  if (!isTenantIdShape(tenantId)) return false;
  const knex = await getAdminConnection();
  const row = await tenantDb(knex, DISCOVERY_SCOPE)
    .unscoped('payment_provider_configs', 'check tenant has enabled Stripe config for per-tenant webhook route')
    .where({ provider_type: 'stripe', is_enabled: true, tenant: tenantId })
    .first('tenant');
  return !!row;
}
