import type { Knex } from 'knex';
import type Stripe from 'stripe';

/** Stable key of the co-managed technician seat offer. */
export const CO_MANAGED_SEAT_OFFER_KEY = 'co_managed_technician_seat';
/** Offer keys that may still be served by a legacy environment binding until they are managed. */
export const LEGACY_ENV_BINDINGS: Readonly<Record<string, { env: string; interval: BillingInterval }>> = {
  [CO_MANAGED_SEAT_OFFER_KEY]: { env: 'STRIPE_CO_MANAGED_USER_PRICE_ID', interval: 'month' },
};

export type EnvLike = Record<string, string | undefined>;

export type BillingInterval = 'day' | 'week' | 'month' | 'year';

/** Merchant scope. Always derived from trusted server configuration, never from a browser. */
export interface CatalogScope { stripeAccount: string; livemode: boolean }

export interface OfferVersionRow {
  version_id: string;
  stripe_account: string;
  livemode: boolean;
  offer_key: string;
  billing_interval: BillingInterval;
  version_number: number;
  price_id: string;
  product_id: string;
  is_current: boolean;
  published_by: string;
  created_at: Date;
  retired_at: Date | null;
}

/** Stripe-derived terms. Re-read from Stripe on every review; never the stored authority. */
export interface OfferTerms { unitAmount: number; currency: string; interval: BillingInterval; intervalCount: number }

export interface ResolvedOffer {
  /** `catalog`: a managed version; `legacy_env`: key not managed yet, served by the env binding. */
  source: 'catalog' | 'legacy_env';
  offerKey: string;
  interval: BillingInterval;
  versionId: string | null;
  versionNumber: number | null;
  priceId: string;
  productId: string;
  terms: OfferTerms;
  scope: CatalogScope;
}

export interface ClassifiedPrice {
  source: 'catalog' | 'legacy_env';
  offerKey: string;
  interval: BillingInterval;
  versionId: string | null;
  /** True when this is the version new sales would use right now. */
  current: boolean;
}

export type OfferUnavailableReason =
  | 'not_configured' | 'no_current_version' | 'invalid_mapping' | 'stripe_unavailable' | 'catalog_unavailable' | 'scope_unavailable';

/** A new sale cannot be priced. Fail closed. Historical recognition never throws this. */
export class OfferUnavailableError extends Error {
  readonly code = 'OFFER_UNAVAILABLE';
  constructor(readonly reason: OfferUnavailableReason, message: string, readonly cause?: unknown) {
    super(message);
    this.name = 'OfferUnavailableError';
  }
}

/** The price a customer reviewed is no longer the current one. A fresh review is required. */
export class OfferTermsChangedError extends Error {
  readonly code = 'OFFER_TERMS_CHANGED';
  constructor(readonly reviewedVersionId: string | null, readonly current: ResolvedOffer) {
    super('The price for this offer changed after you reviewed it. Review the updated terms to continue.');
    this.name = 'OfferTermsChangedError';
  }
}

/** A price seen on a subscription or event that the catalog cannot place. Capacity must not change. */
export class UnmappedPriceError extends Error {
  readonly code = 'UNMAPPED_PRICE';
  constructor(readonly priceId: string) {
    super(`Stripe price ${priceId} is not bound to any co-managed offer version. Capacity was left unchanged; `
      + 'bind the price with `npm run billing-catalog -- publish|seed` after verifying it with the operator, then retry reconciliation.');
    this.name = 'UnmappedPriceError';
  }
}

export type PublishErrorCode =
  | 'UNAUTHORIZED' | 'INVALID_CANDIDATE' | 'WRONG_MODE' | 'BOUND_TO_OTHER_OFFER' | 'STALE_EXPECTED_VERSION' | 'STRIPE_UNAVAILABLE';

export class OfferPublishError extends Error {
  constructor(readonly code: PublishErrorCode, message: string, readonly problems: string[] = []) {
    super(message);
    this.name = 'OfferPublishError';
  }
}

/** Authority proven by the master-tenant gate. Only that gate should construct one. */
export interface CatalogOperator { tenantId: string; userId: string }

export interface CatalogDeps {
  db: Knex;
  stripe: Pick<Stripe, 'prices'>;
  /** Optional reference inventory used to refuse account switches with live billing references. */
  subscriptions?: Pick<Stripe, 'subscriptions'>['subscriptions'];
  /** Trusted configuration: Stripe account and mode. Resolved lazily and memoised by the caller. */
  scope: () => Promise<CatalogScope>;
  /** The key's mode is available even when no merchant account can yet be resolved. */
  livemode?: () => boolean;
  env?: EnvLike;
}

export type PublishAction = 'seed' | 'publish' | 'restore';
export interface PublishResult {
  changed: boolean;
  action: PublishAction | 'unchanged';
  version: OfferVersionRow;
  previousVersionId: string | null;
  terms: OfferTerms;
}
