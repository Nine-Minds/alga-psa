import { hasPermission } from '@alga-psa/auth/rbac';
import { createTenantKnex, tenantDb } from '@alga-psa/db';
import { getLicenseStateRow, isCoManagedPurchaseSurfaceOpen } from '@alga-psa/licensing';

export type CoManagedPurchaseDiscoveryReason =
  | 'not_internal' | 'tenant_mismatch' | 'surface_closed' | 'no_permission' | 'not_hosted_pro' | 'self_host';

export type CoManagedPurchaseDiscovery = { eligible: true } | { eligible: false; reason: CoManagedPurchaseDiscoveryReason };

type Principal = { user_type: string; tenant?: string | null };

/**
 * The one commercial-eligibility decision for first-purchase discovery of co-managed seats. The sidebar,
 * the root layout, the page and its metadata all resolve it for the authenticated principal and tenant,
 * so a visible link always leads to a usable page.
 *
 * It is local and server-authoritative: it reads the release gate, RBAC and the tenant row, and makes no
 * Stripe request. Preview and purchase keep their own live checks (subscription, customer, product,
 * price). It grants nothing: operational access (co-management permissions and the capability's
 * participation) is a separate fact decided elsewhere.
 */
// LEVERAGE: pattern co-managed-purchase-admission — "internal + account_management read/update + surface open" is written here as well as in coManagedBillingActions.requirePurchaser.
export async function resolveCoManagedPurchaseDiscovery(user: Principal, tenant: string): Promise<CoManagedPurchaseDiscovery> {
  if (user.user_type !== 'internal') return { eligible: false, reason: 'not_internal' };
  if (user.tenant && user.tenant !== tenant) return { eligible: false, reason: 'tenant_mismatch' };
  // Kill switch, release flag and configured price; no data is read when it is closed.
  if (!await isCoManagedPurchaseSurfaceOpen(tenant)) return { eligible: false, reason: 'surface_closed' };
  if (!await hasPermission(user as never, 'account_management', 'read') ||
      !await hasPermission(user as never, 'account_management', 'update')) return { eligible: false, reason: 'no_permission' };
  const { knex } = await createTenantKnex(tenant);
  const owner = await tenantDb(knex, tenant).table('tenants').first('product_code', 'plan', 'billing_source');
  if (owner?.product_code !== 'psa' || owner.plan !== 'pro' || owner.billing_source === 'manual') return { eligible: false, reason: 'not_hosted_pro' };
  if (await getLicenseStateRow()) return { eligible: false, reason: 'self_host' };
  return { eligible: true };
}
