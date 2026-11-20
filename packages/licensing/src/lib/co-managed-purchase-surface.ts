import { capabilityFeatureFlag, forcedValue } from '@alga-psa/core/capability';
import { isFeatureFlagEnabled } from '@alga-psa/core/features';
import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Is anything configured to SELL co-managed seats? Platform (EE) code registers a probe backed by
 * the shared Stripe offer catalog. This is NEW-SALE eligibility, not recognition: a managed offer
 * with no sellable current version reports false (fail closed). Without a probe (CE, or EE before
 * the catalog module loads) only the legacy environment binding can open the surface.
 */
export interface BillingCatalogContext {
  mode: 'test' | 'live';
  stripeAccount: string | null;
  priceId: string | null;
  source: 'database' | 'environment' | 'unconfigured';
  sellable: boolean;
}

const billingCatalogContextKey = Symbol.for('@alga-psa/licensing/billing-catalog-context');
const sharedGlobal = globalThis as typeof globalThis & { [billingCatalogContextKey]?: AsyncLocalStorage<BillingCatalogContext> };
// Node can include licensing in more than one server bundle. A global symbol keeps each bundle's
// ALS accessor on the same request store while preserving request isolation under concurrency.
const billingCatalogContext = sharedGlobal[billingCatalogContextKey] ??= new AsyncLocalStorage<BillingCatalogContext>();

/** Establish catalog identity for one independent request entry point. */
export function runWithBillingCatalogContext<T>(context: BillingCatalogContext, work: () => T): T {
  return billingCatalogContext.run(context, work);
}

/** The one pure decision used by every surface and purchase path. */
export function resolveCoManagedPurchaseAvailability(context: BillingCatalogContext): boolean {
  return context.sellable && Boolean(context.priceId && context.stripeAccount);
}

export function currentBillingCatalogContext(): BillingCatalogContext | undefined {
  return billingCatalogContext.getStore();
}

async function offerConfigured(): Promise<boolean> {
  const context = currentBillingCatalogContext();
  if (context) return resolveCoManagedPurchaseAvailability(context);
  // CE and older deployments keep the legacy bootstrap behavior until an EE request loader exists.
  return Boolean(process.env.STRIPE_CO_MANAGED_USER_PRICE_ID);
}

/**
 * Is the co-managed *purchase* surface open for this tenant?
 *
 * The capability's `admits` cannot answer this: eligibility there is an entitlement row, and a
 * purchase is how the first row comes to exist. The surface is therefore the kill switch, the
 * release flag, and a configured price. Absent configuration, a closed flag, or
 * `FORCE_CAPABILITIES=co-managed:off` leave it inert and nothing is read or written. It grants
 * nothing: capacity is only ever raised by verified reconciliation.
 */
export async function isCoManagedPurchaseSurfaceOpen(tenantId: string): Promise<boolean> {
  if (!await offerConfigured()) return false;
  const forced = forcedValue(process.env.FORCE_CAPABILITIES, 'co-managed');
  if (forced === 'off' || forced === 'malformed') return false;
  if (forced === 'on') return true;
  try {
    return await isFeatureFlagEnabled(capabilityFeatureFlag('co-managed'), { tenantId });
  } catch {
    return false;
  }
}
