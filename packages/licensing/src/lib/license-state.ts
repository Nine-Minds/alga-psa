/**
 * Admin-DB accessor for the license_state singleton.
 *
 * The presence of a row activates self-host licensing mode (offline license /
 * trial). Absence means SaaS/Stripe resolution is used — the existing behaviour
 * is fully preserved when no row exists.
 */
import { getAdminConnection } from '@alga-psa/db/admin';
import type { TenantTier } from '@alga-psa/types';
import { isEnterprise } from '@alga-psa/core/features';
import { verifyLicense, clearLicenseVerifyCache } from './verify-license';
import { isLicenseVerifyFailure } from './license-types';

/** Raw row from the license_state table. */
export interface LicenseStateRow {
  id: number;
  edition_choice: string;
  trial_started_at: Date | null;
  license_token: string | null;
  updated_at: Date;
  /** Connected-appliance columns (added by migration 20260531000000) */
  appliance_id: string | null;
  check_in_url: string | null;
  /**
   * The per-appliance credential, stored in PLAINTEXT (high-entropy random
   * bytes; the DB is access-controlled). The daily check-in caller posts it to
   * `check_in_url` to renew the connected license; alga-license hashes it
   * server-side for lookup. (The *hash* lives only in alga-license, not here.)
   */
  appliance_credential: string | null;
  last_checkin_at: Date | null;
  /**
   * Subscription context from the last alga-license check-in (migration
   * 20261016000000). All null/absent = no known subscription event (legacy
   * appliance, never connected, or the subscription is healthy). Optional so
   * an un-migrated row still type-checks and resolves.
   */
  subscription_state?: SubscriptionStateValue | null;
  subscription_cancels_at?: Date | null;
  subscription_resubscribe_url?: string | null;
  subscription_context_updated_at?: Date | null;
  /**
   * Failing-renewal-payment context (migration 20261031230000). Optional end to
   * end: absent/null on legacy rows, older alga-license servers and any state
   * other than payment_failed (next_retry_at, update_payment_url) / cancelled
   * (end_reason).
   */
  subscription_next_retry_at?: Date | null;
  subscription_update_payment_url?: string | null;
  subscription_end_reason?: SubscriptionEndReasonValue | null;
}

/** Subscription states the check-in contract can report (stored verbatim). */
export type SubscriptionStateValue = 'active' | 'cancel_scheduled' | 'term_ends' | 'cancelled' | 'payment_failed';

/** Why a cancelled subscription ended, when the check-in says so. */
export type SubscriptionEndReasonValue = 'payment_failed';

/** Derived licensing state for an install. */
export type LicenseStateKind =
  | 'ce'            // Community Edition chosen — always essentials
  | 'trial_available' // EE install, no license, trial not yet used — essentials, trial can be started
  | 'trial'         // Enterprise trial active
  | 'trial_expired' // Trial window elapsed, no license
  | 'licensed'      // Valid unexpired license present
  | 'license_expired' // License was present but has expired
  | 'license_wrong_tenant'; // Validly-signed license, but issued for a different tenant (aud mismatch)

/**
 * Subscription lifecycle surfaced to the UI.
 *  - 'ending' — still licensed (Pro runs until `endsAt`) but the subscription is
 *               cancelled / scheduled to end. Drives the pre-lapse warning.
 *  - 'lapsed' — the token has expired and the subscription had been cancelled:
 *               the install is on the free edition by subscription lapse (not
 *               a generic expiry or credential problem).
 *  - 'payment_failed' — still licensed and NOT ending: the renewal payment
 *               failed and Stripe is retrying. Informational only; it never
 *               changes the tier.
 */
export interface ResolvedSubscription {
  phase: 'ending' | 'lapsed' | 'payment_failed';
  /**
   * Why Pro ends: 'cancelled' = the subscription was cancelled; 'term' = a
   * fixed-term (comp) grant reaches its planned end; 'payment_failed' = renewal
   * payments failed (while retrying, or the end that followed them). Drives the
   * wording only — a term end must never read as a cancellation.
   */
  cause: 'cancelled' | 'term' | 'payment_failed';
  /** When Pro ends (ending) / ended (lapsed). Null only if truly unknown. */
  endsAt: Date | null;
  resubscribeUrl: string | null;
  /** `payment_failed` phase only: Stripe's next retry, when scheduled. */
  nextRetryAt?: Date | null;
  /** `payment_failed` phase only: where to update the payment method. */
  updatePaymentUrl?: string | null;
}

export interface ResolvedLicenseState {
  /** Current licensing state kind. */
  state: LicenseStateKind;
  /** Effective tier for this install. */
  tier: TenantTier;
  /** When the current entitlement (trial or license) expires, if applicable. */
  expiresAt: Date | null;
  /** Days remaining until expiry (null when no expiry or already expired). */
  daysRemaining: number | null;
  /**
   * Cancelled-subscription context, or null. Additive: `state`/`tier` are
   * unchanged for existing consumers (a lapse is still `license_expired` /
   * `essentials`; the downgrade is defined by that resolution, nothing is
   * deleted).
   */
  subscription: ResolvedSubscription | null;
}

const TRIAL_DURATION_MS = 15 * 24 * 60 * 60 * 1000;

/**
 * Reads the license_state singleton from the admin DB.
 * Returns null when no row exists (SaaS mode — fall through to Stripe logic).
 */
export async function getLicenseStateRow(): Promise<LicenseStateRow | null> {
  const knex = await getAdminConnection();
  // Admin-scoped singleton: keep raw admin DB access so tenantDb fails closed.
  const row = await knex('license_state').orderBy('id').first();
  return row ?? null;
}

/**
 * Upserts the license_state singleton.
 * There should be exactly one row; this creates or updates it.
 */
export async function upsertLicenseState(
  fields: Partial<Omit<LicenseStateRow, 'id' | 'updated_at'>>
): Promise<void> {
  const knex = await getAdminConnection();
  // Admin-scoped singleton: keep raw admin DB access so tenantDb fails closed.
  const existing = await knex('license_state').first('id');
  if (existing) {
    await knex('license_state')
      .where({ id: existing.id })
      .update({ ...fields, updated_at: knex.fn.now() });
  } else {
    await knex('license_state').insert({ ...fields, updated_at: knex.fn.now() });
  }
  clearLicenseVerifyCache();
}

/**
 * Pre-lapse warning: the install is still licensed but the last check-in said
 * the subscription is cancelled or scheduled to end. Null otherwise — including
 * `active` and legacy rows with no subscription data.
 */
function resolveEndingSubscription(row: LicenseStateRow, tokenExp: Date): ResolvedSubscription | null {
  const sub = row.subscription_state;
  if (sub === 'payment_failed') {
    // Still entitled: Pro runs until the token's exp (and beyond, if a payment
    // lands and the next check-in renews it). Never a downgrade by itself.
    return {
      phase: 'payment_failed',
      cause: 'payment_failed',
      endsAt: tokenExp,
      resubscribeUrl: row.subscription_resubscribe_url ?? null,
      nextRetryAt: row.subscription_next_retry_at ? new Date(row.subscription_next_retry_at) : null,
      updatePaymentUrl: row.subscription_update_payment_url ?? null,
    };
  }
  if (sub !== 'cancelled' && sub !== 'cancel_scheduled' && sub !== 'term_ends') return null;
  // Pro runs until the held token's exp even once the subscription is
  // cancelled (soft revocation never hard-cuts), so that is the end date. A
  // scheduled end that is known is more precise while the token is still rolling.
  const cancelsAt = row.subscription_cancels_at ? new Date(row.subscription_cancels_at) : null;
  const endsAt = sub !== 'cancelled' && cancelsAt ? cancelsAt : tokenExp;
  const cause = sub === 'term_ends' ? 'term' : row.subscription_end_reason === 'payment_failed' ? 'payment_failed' : 'cancelled';
  return { phase: 'ending', cause, endsAt, resubscribeUrl: row.subscription_resubscribe_url ?? null };
}

/**
 * Expired-token result. When the last check-in recorded a cancelled
 * subscription (or a scheduled end that has now passed) the lapse carries
 * subscription context so callers can say *why* Pro ended and where to
 * resubscribe; otherwise it is a plain `license_expired`.
 */
function licenseExpired(row: LicenseStateRow, tokenExp: Date | null, now: number): ResolvedLicenseState {
  const sub = row.subscription_state;
  const cancelsAt = row.subscription_cancels_at ? new Date(row.subscription_cancels_at) : null;
  const subscriptionEnded =
    sub === 'cancelled' ||
    ((sub === 'cancel_scheduled' || sub === 'term_ends') && cancelsAt !== null && cancelsAt.getTime() <= now);
  return {
    state: 'license_expired',
    tier: 'essentials',
    expiresAt: null,
    daysRemaining: null,
    subscription: subscriptionEnded
      ? { phase: 'lapsed', cause: sub === 'term_ends' ? 'term' : row.subscription_end_reason === 'payment_failed' ? 'payment_failed' : 'cancelled', endsAt: tokenExp ?? cancelsAt, resubscribeUrl: row.subscription_resubscribe_url ?? null }
      : null,
  };
}

/**
 * Resolves the current effective tier from a license_state row.
 *
 * Resolution order (per spec):
 *   1. Valid unexpired license → license.tier
 *   2. Active 15-day trial     → 'pro'
 *   3. Everything else         → 'essentials'
 *
 * Returns null when passed null (no row → caller falls through to SaaS logic).
 *
 * `expectedTenantId` is the tenant this install belongs to. When a license
 * carries an `aud` (audience) claim it is bound to that tenant: if the caller
 * supplies a tenant that doesn't match, the license resolves to
 * `license_wrong_tenant`/essentials rather than granting its tier. Unbound
 * licenses (no `aud`, every license issued to date) are accepted on any
 * appliance, so this is forward-compatible — binding only takes effect once the
 * issuer starts stamping `aud`. Callers that have no tenant in scope omit the
 * argument and the check is skipped (the strict gate is submitLicense, which
 * always has the session tenant at activation time).
 */
export function resolveSelfHostTier(
  row: LicenseStateRow | null,
  expectedTenantId?: string,
): ResolvedLicenseState | null {
  if (!row) return null;

  const now = Date.now();

  // 1. Check for a valid license.
  if (row.license_token) {
    const result = verifyLicense(row.license_token);
    if (result.valid) {
      const expMs = result.claims.exp * 1000;
      if (expMs > now) {
        // Per-tenant binding: a bound token (carries `aud`) is only honored on
        // the appliance whose tenant matches. We only block when we actually
        // have a tenant to compare against — an unbound token, or a missing
        // expectedTenantId, falls through to the normal licensed result.
        if (result.claims.aud && expectedTenantId && result.claims.aud !== expectedTenantId) {
          return { state: 'license_wrong_tenant', tier: 'essentials', expiresAt: null, daysRemaining: null, subscription: null };
        }
        const daysRemaining = Math.ceil((expMs - now) / (24 * 60 * 60 * 1000));
        return {
          state: 'licensed',
          tier: result.claims.tier,
          expiresAt: new Date(expMs),
          daysRemaining,
          subscription: resolveEndingSubscription(row, new Date(expMs)),
        };
      }
      // Claims valid but exp in the past (shouldn't reach here — verifyLicense
      // already checks expiry, but guard for clock-skew edge cases).
      return licenseExpired(row, new Date(expMs), now);
    }
    // Expired token: surface as license_expired, not trial_expired.
    //
    // THIS IS THE DEFINED DOWNGRADE for a lapsed Pro subscription: at the held
    // token's `exp` the install resolves to `essentials` (CE behavior). Every
    // Pro gate (assertTierAccess, eeRuntimeEnabledServer, the seat guard) keys
    // off this tier, so they degrade to free-edition behavior. No data is
    // deleted; reactivation stores a fresh token on the next `ok` check-in and
    // this resolver returns `licensed` again.
    if (isLicenseVerifyFailure(result) && result.reason === 'expired') {
      return licenseExpired(row, result.expiredAt ? new Date(result.expiredAt * 1000) : null, now);
    }
    // Malformed/bad_signature/unknown_kid — treat as if no token stored.
  }

  // 2. Check CE choice (no trial available).
  if (row.edition_choice === 'ce') {
    return { state: 'ce', tier: 'essentials', expiresAt: null, daysRemaining: null, subscription: null };
  }

  // 3. Check active trial.
  if (row.trial_started_at) {
    const trialEnd = new Date(row.trial_started_at).getTime() + TRIAL_DURATION_MS;
    if (trialEnd > now) {
      const daysRemaining = Math.ceil((trialEnd - now) / (24 * 60 * 60 * 1000));
      return {
        state: 'trial',
        tier: 'pro',
        expiresAt: new Date(trialEnd),
        daysRemaining,
        subscription: null,
      };
    }
    return { state: 'trial_expired', tier: 'essentials', expiresAt: null, daysRemaining: null, subscription: null };
  }

  // 4. EE chosen but no trial started yet — essentials until trial starts.
  // Distinct from trial_expired: a fresh install has NOT used its trial, and
  // surfacing it as "expired" (banner + License page) misleads on day one.
  return { state: 'trial_available', tier: 'essentials', expiresAt: null, daysRemaining: null, subscription: null };
}

/**
 * Server-side EE-runtime check for edition-only feature gates that are NOT
 * covered by the tier-aware assertTierAccess (e.g. calendar, Microsoft-consumer,
 * AI endpoints — features gated by edition rather than a TIER_FEATURES entry).
 *
 * Semantics:
 *   - CE build                              → false
 *   - EE build, no license_state row (SaaS) → true (behaviour unchanged)
 *   - EE build, self-host @ essentials      → false (behaves as CE)
 *   - EE build, self-host licensed/trial    → true
 *
 * Falls back to the build-time edition on any DB error so a transiently
 * unavailable license_state table never disables EE features on a hosted EE
 * deployment.
 */
export async function eeRuntimeEnabledServer(): Promise<boolean> {
  if (!isEnterprise) return false;
  try {
    const row = await getLicenseStateRow();
    // No tenant is threaded here (this is a global edition check, not a
    // per-tenant action), so a tenant-bound license isn't re-validated against
    // `aud`. That's intentional: submitLicense is the binding chokepoint — it
    // refuses to store a token whose `aud` doesn't match this install's tenant —
    // so a stored token is always either this tenant's or unbound (legacy).
    const resolved = resolveSelfHostTier(row);
    if (resolved === null) return true; // SaaS / no self-host record
    return resolved.tier !== 'essentials';
  } catch {
    return true; // EE build; don't disable features if license_state is unavailable
  }
}

/**
 * True when this install manages its own entitlement via a self-host
 * `license_state` row (offline appliance / self-hosted). SaaS/hosted has no row
 * → false.
 *
 * Use to gate the self-host licensing UI — the License page, the purchase flow,
 * and the trial/expiry banner — so none of it surfaces on hosted/SaaS
 * deployments. Mirrors the `resolveSelfHostTier(...) === null` SaaS check used
 * by getLicenseStatus/eeRuntimeEnabledServer. Defaults to false on any DB error
 * so the licensing UI is hidden (not shown to SaaS) when license_state can't be
 * read.
 */
export async function isSelfHostLicensing(): Promise<boolean> {
  try {
    return resolveSelfHostTier(await getLicenseStateRow()) !== null;
  } catch {
    return false;
  }
}

export class HostingRequiredError extends Error {
  public readonly statusCode = 403;
  public readonly code = 'HOSTING_REQUIRED';

  constructor(featureLabel = 'This feature') {
    super(`${featureLabel} is only available on hosted installs.`);
    this.name = 'HostingRequiredError';
  }
}

export async function assertHostedInstall(featureLabel?: string): Promise<void> {
  if (await isSelfHostLicensing()) {
    throw new HostingRequiredError(featureLabel);
  }
}

/**
 * True only for the Nine Minds appliance-license distribution tenant WHEN in-app
 * distribution is switched on. Gated by two env vars:
 *   - `MASTER_BILLING_TENANT_ID` — identifies the Nine Minds tenant (the same
 *     master-tenant gate platform reports use);
 *   - `ALGA_LICENSE_DISTRIBUTION_ENABLED` — the dark-launch switch. The whole
 *     distribution stack (purchase template authoring, checkout creation, and the
 *     client-portal license surface) stays off until this is set to 'true', so
 *     the surface can ship dark and be activated once C4 + Stripe prices are live.
 *
 * Synchronous env compare — no DB. Fails closed: with either var unset (every
 * appliance / self-host, and any SaaS box before distribution is switched on) no
 * tenant matches, so the distribution surface stays hidden everywhere.
 */
export function isLicenseDistributionTenant(tenant: string | null | undefined): boolean {
  const master = process.env.MASTER_BILLING_TENANT_ID;
  const enabled = process.env.ALGA_LICENSE_DISTRIBUTION_ENABLED === 'true';
  return enabled && !!master && !!tenant && tenant === master;
}
