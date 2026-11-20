import { capabilityFeatureFlag, forcedValue } from '@alga-psa/core/capability';
import { isFeatureFlagEnabled } from '@alga-psa/core/features';

export type CoManagedPurchaseBlockedReason =
  | 'customer_unverified'
  | 'no_current_pro'
  | 'offer_paused'
  | 'offer_changed'
  | 'misconfigured'
  | 'temporarily_unavailable';

/**
 * Is anything configured to SELL co-managed seats? Platform (EE) code registers a probe backed by
 * the shared Stripe offer catalog. This is NEW-SALE eligibility, not recognition: a managed offer
 * with no sellable current version reports false (fail closed). Without a probe (CE, or EE before
 * the catalog module loads) only the legacy environment binding can open the surface.
 */
export type CoManagedOfferAvailability = () => Promise<boolean>;
let offerAvailability: CoManagedOfferAvailability | undefined;

export function registerCoManagedOfferAvailability(probe: CoManagedOfferAvailability | undefined): void {
  offerAvailability = probe;
}

async function offerConfigured(): Promise<boolean> {
  if (!offerAvailability) return Boolean(process.env.STRIPE_CO_MANAGED_USER_PRICE_ID); // legacy, unmanaged only
  try { return await offerAvailability(); } catch { return false; }
}

/** Release and kill-switch gate shared by purchase actions; it does not classify offer availability. */
export async function isCoManagedPurchaseFeatureEnabled(tenantId: string): Promise<boolean> {
  const forced = forcedValue(process.env.FORCE_CAPABILITIES, 'co-managed');
  if (forced === 'off' || forced === 'malformed') return false;
  if (forced === 'on') return true;
  try {
    return await isFeatureFlagEnabled(capabilityFeatureFlag('co-managed'), { tenantId });
  } catch {
    return false;
  }
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
  return isCoManagedPurchaseFeatureEnabled(tenantId);
}
