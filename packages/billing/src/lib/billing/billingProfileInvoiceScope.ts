import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import type { IBillingCharge } from '@alga-psa/types';
import { featureFlags } from '@alga-psa/core/server';
import { ensureClientDefaultBillingProfile } from '@alga-psa/shared/billingClients/billingProfiles';
import { listSeparatelyBillingProfiles } from '@alga-psa/shared/billingClients/billingProfileSettings';

/**
 * Which charges belong on the invoice a given billing cycle produces (F094).
 *
 * This is the point where invoice *production* changes, so the rule is written
 * to make the unsegmented case provably untouched:
 *
 *   No profile of the client bills separately  → **no filtering at all**. One
 *   invoice per client per cycle, exactly as in phase 1, with charges merely
 *   labelled by segment. This is every client until an MSP opts one in.
 *
 *   Some profile bills separately → the cycle's profile takes its own charges.
 *   The **default** profile additionally takes everything belonging to profiles
 *   that do *not* bill separately, because those segments are reporting
 *   dimensions, not billing entities — dropping them would silently unbill real
 *   work.
 *
 * The second half is the part that is easy to get wrong. A rule of "each cycle
 * takes only its own profile's charges" loses every charge attributed to a
 * non-separately-billing sibling, and the loss is invisible: the invoice simply
 * comes out smaller.
 */

export const PER_PROFILE_INVOICING_FLAG = 'billing-profiles-separate-invoicing';

export interface InvoiceProfileScope {
  /** True when this cycle should filter charges at all. */
  isScoped: boolean;
  billingProfileId: string;
  isDefaultProfile: boolean;
  separatelyBillingProfileIds: Set<string>;
}

/**
 * Per-profile invoice production is gated behind a per-tenant feature flag
 * (F101). With the flag off, `bills_separately` is inert and generation behaves
 * exactly as it did before this slice — which is the property T037 asserts.
 */
export async function perProfileInvoicingEnabled(
  tenant: string,
  userId?: string,
): Promise<boolean> {
  return featureFlags.isEnabled(PER_PROFILE_INVOICING_FLAG, {
    tenantId: tenant,
    userId,
  });
}

export async function resolveInvoiceProfileScope(
  knex: Knex | Knex.Transaction,
  tenant: string,
  clientId: string,
  cycleBillingProfileId: string | null | undefined,
  options?: { userId?: string },
): Promise<InvoiceProfileScope> {
  const defaultProfileId = await ensureClientDefaultBillingProfile(knex, tenant, clientId);
  const billingProfileId = cycleBillingProfileId ?? defaultProfileId;
  const isDefaultProfile = billingProfileId === defaultProfileId;

  if (!(await perProfileInvoicingEnabled(tenant, options?.userId))) {
    return {
      isScoped: false,
      billingProfileId,
      isDefaultProfile,
      separatelyBillingProfileIds: new Set(),
    };
  }

  const separatelyBilling = await listSeparatelyBillingProfiles(knex, tenant, clientId);
  return {
    // Nothing bills separately → nothing to split, so do not filter. This is
    // what keeps a single-profile client's invoice byte-identical.
    isScoped: separatelyBilling.length > 0,
    billingProfileId,
    isDefaultProfile,
    separatelyBillingProfileIds: new Set(
      separatelyBilling.map((profile) => profile.billing_profile_id),
    ),
  };
}

export function chargeBelongsToScope(
  charge: Pick<IBillingCharge, 'billing_profile_id'>,
  scope: InvoiceProfileScope,
): boolean {
  if (!scope.isScoped) return true;

  const chargeProfileId = charge.billing_profile_id ?? null;
  if (chargeProfileId === scope.billingProfileId) return true;

  // A charge with no attribution at all cannot be assigned to a separately
  // billing profile, so it belongs on the client's main invoice rather than
  // being dropped.
  if (!chargeProfileId) return scope.isDefaultProfile;

  // Non-separately-billing segments roll up onto the default profile's invoice.
  return scope.isDefaultProfile && !scope.separatelyBillingProfileIds.has(chargeProfileId);
}

export function scopeChargesToProfile<T extends Pick<IBillingCharge, 'billing_profile_id'>>(
  charges: T[],
  scope: InvoiceProfileScope,
): T[] {
  if (!scope.isScoped) return charges;
  return charges.filter((charge) => chargeBelongsToScope(charge, scope));
}

/** The cycle's billing profile, or the client default for a pre-S8 cycle. */
export async function getCycleBillingProfileId(
  knex: Knex | Knex.Transaction,
  tenant: string,
  billingCycleId: string,
): Promise<string | null> {
  const row = await tenantDb(knex, tenant)
    .table('client_billing_cycles')
    .where({ billing_cycle_id: billingCycleId })
    .first('billing_profile_id');
  return (row?.billing_profile_id as string | null) ?? null;
}
