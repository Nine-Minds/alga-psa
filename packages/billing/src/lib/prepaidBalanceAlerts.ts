/**
 * Pure, server-free policy math for prepaid balance alerts (task 29.8.20).
 *
 * Two intentionally asymmetric boundaries:
 *
 *  - Credit is low ONLY when `available < threshold`; equality resolves and
 *    rearms the episode.
 *  - A bucket has reached its limit when `minutes_used * 100 >=
 *    configured_percent * (total_minutes + rolled_over_minutes)`; equality
 *    alerts.
 *
 * This module has no imports and no side effects so it can be unit-tested
 * standalone and reused by the evaluator without leaking server concerns.
 */

export type PrepaidAlertType = 'credit' | 'bucket';

export interface CreditPolicySnapshot {
  threshold: number;
  currencyCode: string;
}

export interface BucketPolicySnapshot {
  percent: number;
}

export interface CreditObservationInput {
  /** Available prepaid credit in minor units for the configured currency. */
  available: number;
  /** True only when at least one historical credit_tracking row exists for client/currency. */
  hasHistory: boolean;
  /** Positive minor-unit credit floor. */
  threshold: number;
}

export interface BucketObservationInput {
  minutesUsed: number;
  totalMinutes: number;
  rolledOverMinutes: number;
  configuredPercent: number;
  /** Settled additive hour-block minutes applicable to this bucket/service. */
  additionalMinutes?: number;
}

/** Capacity is base allowance plus rollover. */
export function bucketCapacity(input: BucketObservationInput): number {
  return input.totalMinutes + input.rolledOverMinutes + (input.additionalMinutes ?? 0);
}

/**
 * Credit is low strictly below the configured floor. Equality (and any value
 * at or above the floor) is recovery, never an alert. A client with no credit
 * history must never generate a zero-balance alert.
 */
export function isCreditLow(input: CreditObservationInput): boolean {
  if (!input.hasHistory) {
    return false;
  }
  return input.available < input.threshold;
}

/**
 * Non-positive capacity is invalid (divided by zero would be a degenerate
 * alert); callers must emit a structured warning instead of alerting.
 */
export function hasValidBucketCapacity(input: BucketObservationInput): boolean {
  return bucketCapacity(input) > 0;
}

/**
 * Exact integer cross-multiplication — no floats, no clamped percentage. A
 * consumed value above capacity yields a percentage above 100.
 */
export function bucketThresholdReached(input: BucketObservationInput): boolean {
  const capacity = bucketCapacity(input);
  if (capacity <= 0) {
    return false;
  }
  return input.minutesUsed * 100 >= input.configuredPercent * capacity;
}

/**
 * Observed consumption percentage, unclamped (may exceed 100). Rounded only
 * for display by the caller; never used to decide the alert.
 */
export function bucketUsedPercent(input: BucketObservationInput): number {
  const capacity = bucketCapacity(input);
  if (capacity <= 0) {
    return 0;
  }
  return (input.minutesUsed * 100) / capacity;
}

/**
 * Stable dedupe key for one below-threshold credit episode. The episode number
 * is monotonically increasing per client/currency: recovery rearms and a later
 * drop opens the next episode, so consecutive episodes never collide.
 */
export function creditDedupeKey(clientId: string, currencyCode: string, episode: number): string {
  return `credit:${clientId}:${currencyCode}:ep${episode}`;
}

/**
 * Stable identity for one bucket_usage period + configured percentage. Unlike
 * credit, bucket alerts do not rearm within the same usage period: returning
 * to a percentage that already alerted reuses the same logical alert row.
 */
export function bucketDedupeKey(bucketUsageId: string, configuredPercent: number): string {
  return `bucket:${bucketUsageId}:${configuredPercent}pct`;
}

/** A threshold or currency change resolves the prior episode as policy_changed. */
export function creditPolicyChanged(
  previous: CreditPolicySnapshot | null,
  next: CreditPolicySnapshot
): boolean {
  if (!previous) {
    return false;
  }
  return previous.threshold !== next.threshold || previous.currencyCode !== next.currencyCode;
}

/** A configured percentage change resolves/re-evaluates the old policy alert. */
export function bucketPolicyChanged(previousPercent: number | null, nextPercent: number): boolean {
  return previousPercent !== null && previousPercent !== nextPercent;
}

/** Normalize a recipient key (email addresses) by trim + lowercase. */
export function normalizeRecipientKey(value: string): string {
  return value.trim().toLowerCase();
}

/** Resolution reasons persisted on the alert ledger. */
export const RESOLUTION_REASON_RECOVERED = 'recovered';
export const RESOLUTION_REASON_POLICY_CHANGED = 'policy_changed';

/** Delivery statuses persisted on the delivery ledger. */
export const DELIVERY_STATUS_PENDING = 'pending';
export const DELIVERY_STATUS_PROCESSING = 'processing';
export const DELIVERY_STATUS_SENT = 'sent';
export const DELIVERY_STATUS_SKIPPED = 'skipped';
export const DELIVERY_STATUS_FAILED = 'failed';
export const DELIVERY_STATUS_EXHAUSTED = 'exhausted';
export const DELIVERY_STATUS_SUPERSEDED = 'superseded';

export const DELIVERY_CHANNEL_INTERNAL = 'internal';
export const DELIVERY_CHANNEL_EMAIL = 'email';

/** Maximum delivery attempts before a delivery is exhausted (terminal). */
export const MAX_DELIVERY_ATTEMPTS = 5;

/** Recipient roles recorded in delivery metadata. */
export const RECIPIENT_ROLE_ACCOUNT_MANAGER = 'account_manager';
export const RECIPIENT_ROLE_CLIENT_BILLING = 'client_billing_recipient';
