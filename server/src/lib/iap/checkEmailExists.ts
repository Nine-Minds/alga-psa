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

  const tenant = await knex('tenants').where('email', email).first('tenant');
  if (tenant) return true;

  const adminUser = await knex('users')
    .where({ email, user_type: 'internal' })
    .first('tenant');
  return Boolean(adminUser);
}
