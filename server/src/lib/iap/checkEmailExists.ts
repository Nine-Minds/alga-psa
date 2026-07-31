import { tenantDb } from '@alga-psa/db';
import { getAdminConnection } from '@alga-psa/db/admin';

/**
 * Returns true if the given email is already associated with a tenant —
 * either as a tenant's primary email, or as the email of an internal
 * (admin) user inside any tenant.
 *
 * Mirrors the lookup performed by /api/billing/check-tenant so the IAP
 * pre-purchase check and the Stripe checkout pre-purchase check stay in
 * sync. Used by the mobile IAP flow to bail before kicking off a StoreKit
 * purchase that would otherwise leave the user charged but unprovisioned.
 */
export async function emailHasExistingTenant(email: string): Promise<boolean> {
  const knex = await getAdminConnection();
  const db = tenantDb(knex, '__iap_email_tenant_discovery__');

  const tenant = await db
    .unscoped('tenants', 'tenant discovery for mobile IAP pre-purchase email check')
    .where('email', email)
    .first('tenant');
  if (tenant) return true;

  const adminUser = await db
    .unscoped('users', 'tenant discovery for mobile IAP pre-purchase internal-user email check')
    .where({ email, user_type: 'internal' })
    .first('tenant');
  return Boolean(adminUser);
}
