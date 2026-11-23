import { canDiscoverSeatTrial } from '@enterprise/lib/co-managed/seatTrialDiscovery';
import { cache } from 'react';
import { runWithBillingCatalogRequest } from '@alga-psa/licensing/billing-catalog-scope';
import { getCurrentUser } from '@alga-psa/auth';
import { hasPermission } from '@alga-psa/auth/rbac';
import { serves } from '@alga-psa/core/capability';
import { resolveCoManagedPurchaseDiscovery } from '@enterprise/lib/co-managed/purchaseDiscovery';

/**
 * The access decisions for the Co-Managed IT overview root, resolved for the authenticated
 * principal and tenant and shared by the root layout, the page and its metadata (and, through the same
 * `resolveCoManagedPurchaseDiscovery`, the sidebar action), so a visible link always leads to a usable page.
 *
 *  - `commercial`: first-purchase eligibility (EE policy; always false in the community edition).
 *    Grants only the pool. It carries no Stripe call and no permission.
 *  - `trial`: scoped Seat setup or recovery in EE, including during intake closure.
 *  - `operational`: the capability serves AND the actor holds `co_management:read`: the existing
 *    overview, client visibility and read-only rules.
 *
 * Memoised per request, keyed by tenant, so the layout, page and metadata cannot disagree.
 */
export interface CoManagedRootAccess {
  commercial: boolean;
  trial?: boolean;
  served: boolean;
  operational: boolean;
}

export const resolveCoManagedRootAccess = cache((tenant: string): Promise<CoManagedRootAccess> =>
  // The root render is not a server action, so withAuth does not open the catalog scope for it. This is the
  // one function the layout, page and metadata share (cache() above), so the scope opened here covers every
  // gate check the render makes: purchase discovery, trial discovery and the capability's eligibility.
  runWithBillingCatalogRequest(() => resolveRootAccess(tenant)));

async function resolveRootAccess(tenant: string): Promise<CoManagedRootAccess> {
  const [user, servedDecision] = await Promise.all([getCurrentUser(), serves('co-managed', tenant)]);
  const served = servedDecision.served;
  if (!user || (user.tenant && user.tenant !== tenant)) return { commercial: false, served, operational: false };
  const [commercial, operational] = await Promise.all([
    resolveCoManagedPurchaseDiscovery(user, tenant).then((decision) => decision.eligible),
    served && user.user_type === 'internal' ? hasPermission(user, 'co_management', 'read') : Promise.resolve(false),
  ]);
  const trial = !commercial && await canDiscoverSeatTrial(user, tenant);
  return { commercial, served, operational, ...(trial ? { trial } : {}) };
}
