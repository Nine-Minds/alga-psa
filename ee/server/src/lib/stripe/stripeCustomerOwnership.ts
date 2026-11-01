/**
 * Tenant-ownership proof for Stripe objects (alga-2026-0002926).
 *
 * A Stripe customer / subscription may be bound to a tenant only when its
 * metadata names that tenant. Email is a search key for finding *candidates*
 * and is never proof of ownership (emails are not unique across tenants).
 *
 * METADATA KEY DECISION (single place; do not re-implement with `||` elsewhere):
 *  - `tenant_id` is what this codebase writes on Stripe customers
 *    (StripePaymentProvider.customers.create, saved-payment-method import
 *    stamp) and on every subscription / checkout-session it creates.
 *  - `alga_tenant_id` is the key named in the approved design for customers
 *    created outside this codebase (nm-store). nm-store is not in this repo, so
 *    its key cannot be verified from here; both keys are therefore accepted.
 *  - If both are present they must agree. Disagreement (or an empty value) is
 *    treated as *no proof*, never as "pick one".
 */

export const STRIPE_TENANT_METADATA_KEYS = ['tenant_id', 'alga_tenant_id'] as const;

export type StripeOwnershipFailureCode =
  | 'no_candidates'
  | 'no_owned_candidate'
  | 'ambiguous_owned_candidates'
  | 'customer_deleted'
  | 'not_owned'
  | 'already_bound';

/** Every distinct tenant id named by the object's metadata (across all accepted keys). */
export function stripeMetadataTenants(
  obj: { metadata?: Record<string, string> | null } | null | undefined,
): string[] {
  const metadata = obj?.metadata;
  if (!metadata) return [];
  const values = new Set<string>();
  for (const key of STRIPE_TENANT_METADATA_KEYS) {
    const value = metadata[key];
    if (typeof value === 'string' && value.trim() !== '') values.add(value.trim());
  }
  return [...values];
}

/**
 * Returns the tenant named by the object's metadata, or null when metadata
 * names no tenant or names conflicting tenants.
 */
export function stripeMetadataTenant(
  obj: { metadata?: Record<string, string> | null } | null | undefined,
): string | null {
  const tenants = stripeMetadataTenants(obj);
  return tenants.length === 1 ? tenants[0] : null;
}

/** True when the object's metadata names any tenant other than `tenantId` (conflicting claims included). */
export function stripeMetadataClaimsOtherTenant(
  obj: { metadata?: Record<string, string> | null } | null | undefined,
  tenantId: string,
): boolean {
  return stripeMetadataTenants(obj).some((t) => t !== tenantId);
}

/**
 * Error whose `message` is safe to show to a tenant user. Detail that may
 * name other tenants' Stripe ids lives in `detail`/`candidateIds` and must go to
 * server logs only.
 */
export class StripeOwnershipError extends Error {
  readonly code: StripeOwnershipFailureCode;
  readonly candidateIds: string[];
  readonly detail: string;

  constructor(code: StripeOwnershipFailureCode, tenantId: string, candidateIds: string[] = [], detail = '') {
    super(
      'Unable to link this account to a Stripe billing customer automatically. ' +
        'Please contact support so an operator can verify and link the customer.',
    );
    this.name = 'StripeOwnershipError';
    this.code = code;
    this.candidateIds = candidateIds;
    this.detail =
      `[${code}] tenant ${tenantId}: ${detail}` +
      (candidateIds.length ? ` candidates=[${candidateIds.join(', ')}]` : '') +
      ' Operator recovery: StripeService.linkStripeCustomerToTenant(tenantId, stripeCustomerId, { actor, reason }).';
  }
}

/** Exactly one of customerId / error is non-null. */
export interface OwnedCandidateSelection {
  customerId: string | null;
  error: StripeOwnershipError | null;
}

/** Fail-closed selection: exactly one candidate whose metadata names the tenant, else refuse. */
export function selectOwnedCustomer(
  input: { tenantId: string; accountId: string; purpose: 'saas_billing' | 'client_payment' },
  candidates: Array<{ id: string; deleted?: boolean | void; metadata?: Record<string, string> | null }>,
): OwnedCandidateSelection {
  const { tenantId, accountId, purpose } = input;
  if (candidates.length === 0) {
    return { customerId: null, error: new StripeOwnershipError('no_candidates', tenantId, [], 'no Stripe customer matched the tenant email.') };
  }
  const owned = candidates.filter((c) => !c.deleted && stripeMetadataTenant(c) === tenantId &&
    c.metadata?.stripe_account_id === accountId &&
    (purpose !== 'saas_billing' || c.metadata?.purpose === 'saas_billing'));
  if (owned.length === 0) {
    return {
      customerId: null,
      error: new StripeOwnershipError(
        'no_owned_candidate',
        tenantId,
        candidates.map((c) => c.id),
        'Stripe customers matched the tenant email but none carries ownership metadata for this tenant.',
      ),
    };
  }
  if (owned.length > 1) {
    return {
      customerId: null,
      error: new StripeOwnershipError(
        'ambiguous_owned_candidates',
        tenantId,
        owned.map((c) => c.id),
        'more than one Stripe customer claims this tenant.',
      ),
    };
  }
  return { customerId: owned[0].id, error: null };
}
