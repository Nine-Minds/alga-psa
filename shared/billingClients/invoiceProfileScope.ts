import type { IBillingCharge } from '@alga-psa/types';

/**
 * The pure half of invoice profile scoping (F094): which charges belong on the
 * invoice a given billing profile produces, and therefore which profile's
 * payment terms stamp that invoice's due date.
 *
 * The I/O half (`resolveInvoiceProfileScope`, the `billing-profiles-separate-invoicing`
 * tenant flag) stays in `packages/billing`; the flag value reaches this module
 * only as the `perProfileInvoicing` input. The invoice engine and the contract
 * billing trace both decide "which invoice does this charge land on" through
 * `resolveInvoiceProfileForAttribution`, so they cannot disagree.
 *
 *   Flag off, or no profile bills separately → no filtering: everything lands on
 *   the default profile's invoice (attribution is a reporting dimension only).
 *
 *   Otherwise a separately billing profile takes its own charges; the default
 *   profile takes everything else, including unattributed charges.
 */

export interface InvoiceProfileScope {
  /** True when this cycle should filter charges at all. */
  isScoped: boolean;
  billingProfileId: string;
  isDefaultProfile: boolean;
  separatelyBillingProfileIds: Set<string>;
}

export interface InvoiceProfileScopeInput {
  /** The invoice's own profile (the cycle's profile, or the default). */
  billingProfileId: string;
  defaultProfileId: string;
  /** Tenant flag `billing-profiles-separate-invoicing`, evaluated by the caller. */
  perProfileInvoicing: boolean;
  /** Active profiles with `bills_separately = true` (`listSeparatelyBillingProfiles`). */
  separatelyBillingProfileIds: Iterable<string>;
}

export function buildInvoiceProfileScope(input: InvoiceProfileScopeInput): InvoiceProfileScope {
  const isDefaultProfile = input.billingProfileId === input.defaultProfileId;
  if (!input.perProfileInvoicing) {
    return {
      isScoped: false,
      billingProfileId: input.billingProfileId,
      isDefaultProfile,
      separatelyBillingProfileIds: new Set(),
    };
  }
  const separatelyBillingProfileIds = new Set(input.separatelyBillingProfileIds);
  return {
    // Nothing bills separately → nothing to split, so do not filter. This is
    // what keeps a single-profile client's invoice byte-identical.
    isScoped: separatelyBillingProfileIds.size > 0,
    billingProfileId: input.billingProfileId,
    isDefaultProfile,
    separatelyBillingProfileIds,
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

export type InvoiceProfileLandingReason =
  /** Attributed to the default profile, or unattributed. */
  | 'same_profile'
  /** Attributed elsewhere, and separate invoicing is off for the tenant. */
  | 'separate_invoicing_off'
  /** Attributed elsewhere; the profile does not bill separately (or is inactive). */
  | 'not_billed_separately'
  /** Attributed to a separately billing profile: it keeps its own invoice. */
  | 'own_invoice';

/**
 * On which profile's invoice does a charge attributed to `attributedProfileId`
 * land? `defaultScope` is the scope of the client's default profile. A charge
 * the default scope does not take belongs to its own (separately billing)
 * profile's invoice.
 */
export function resolveInvoiceProfileForAttribution(
  attributedProfileId: string | null | undefined,
  defaultScope: InvoiceProfileScope,
): string {
  const attributed = attributedProfileId ?? null;
  return chargeBelongsToScope({ billing_profile_id: attributed }, defaultScope)
    ? defaultScope.billingProfileId
    : (attributed as string);
}

/** Same decision as `resolveInvoiceProfileForAttribution`, with the reason it differs. */
export function describeInvoiceProfileLanding(
  attributedProfileId: string | null | undefined,
  defaultScope: InvoiceProfileScope,
  perProfileInvoicing: boolean,
): { invoiceProfileId: string; reason: InvoiceProfileLandingReason } {
  const invoiceProfileId = resolveInvoiceProfileForAttribution(attributedProfileId, defaultScope);
  const attributed = attributedProfileId ?? null;
  if (attributed === null || attributed === invoiceProfileId) {
    return {
      invoiceProfileId,
      reason: attributed !== null && attributed !== defaultScope.billingProfileId ? 'own_invoice' : 'same_profile',
    };
  }
  return { invoiceProfileId, reason: perProfileInvoicing ? 'not_billed_separately' : 'separate_invoicing_off' };
}
