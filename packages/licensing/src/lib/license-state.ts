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

/** Raw row from the license_state table. */
export interface LicenseStateRow {
  id: number;
  edition_choice: string;
  trial_started_at: Date | null;
  license_token: string | null;
  updated_at: Date;
}

/** Derived licensing state for an install. */
export type LicenseStateKind =
  | 'ce'            // Community Edition chosen — always essentials
  | 'trial'         // Enterprise trial active
  | 'trial_expired' // Trial window elapsed, no license
  | 'licensed'      // Valid unexpired license present
  | 'license_expired'; // License was present but has expired

export interface ResolvedLicenseState {
  /** Current licensing state kind. */
  state: LicenseStateKind;
  /** Effective tier for this install. */
  tier: TenantTier;
  /** When the current entitlement (trial or license) expires, if applicable. */
  expiresAt: Date | null;
  /** Days remaining until expiry (null when no expiry or already expired). */
  daysRemaining: number | null;
}

const TRIAL_DURATION_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Reads the license_state singleton from the admin DB.
 * Returns null when no row exists (SaaS mode — fall through to Stripe logic).
 */
export async function getLicenseStateRow(): Promise<LicenseStateRow | null> {
  const knex = await getAdminConnection();
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
 * Resolves the current effective tier from a license_state row.
 *
 * Resolution order (per spec):
 *   1. Valid unexpired license → license.tier
 *   2. Active 30-day trial     → 'premium'
 *   3. Everything else         → 'essentials'
 *
 * Returns null when passed null (no row → caller falls through to SaaS logic).
 */
export function resolveSelfHostTier(row: LicenseStateRow | null): ResolvedLicenseState | null {
  if (!row) return null;

  const now = Date.now();

  // 1. Check for a valid license.
  if (row.license_token) {
    const result = verifyLicense(row.license_token);
    if (result.valid) {
      const expMs = result.claims.exp * 1000;
      if (expMs > now) {
        const daysRemaining = Math.ceil((expMs - now) / (24 * 60 * 60 * 1000));
        return {
          state: 'licensed',
          tier: result.claims.tier,
          expiresAt: new Date(expMs),
          daysRemaining,
        };
      }
      // Claims valid but exp in the past (shouldn't reach here — verifyLicense
      // already checks expiry, but guard for clock-skew edge cases).
      return { state: 'license_expired', tier: 'essentials', expiresAt: null, daysRemaining: null };
    }
    // Expired token: surface as license_expired, not trial_expired.
    if (result.reason === 'expired') {
      return { state: 'license_expired', tier: 'essentials', expiresAt: null, daysRemaining: null };
    }
    // Malformed/bad_signature/unknown_kid — treat as if no token stored.
  }

  // 2. Check CE choice (no trial available).
  if (row.edition_choice === 'ce') {
    return { state: 'ce', tier: 'essentials', expiresAt: null, daysRemaining: null };
  }

  // 3. Check active trial.
  if (row.trial_started_at) {
    const trialEnd = new Date(row.trial_started_at).getTime() + TRIAL_DURATION_MS;
    if (trialEnd > now) {
      const daysRemaining = Math.ceil((trialEnd - now) / (24 * 60 * 60 * 1000));
      return {
        state: 'trial',
        tier: 'premium',
        expiresAt: new Date(trialEnd),
        daysRemaining,
      };
    }
    return { state: 'trial_expired', tier: 'essentials', expiresAt: null, daysRemaining: null };
  }

  // 4. EE chosen but no trial started yet — essentials until trial starts.
  return { state: 'trial_expired', tier: 'essentials', expiresAt: null, daysRemaining: null };
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
    const resolved = resolveSelfHostTier(row);
    if (resolved === null) return true; // SaaS / no self-host record
    return resolved.tier !== 'essentials';
  } catch {
    return true; // EE build; don't disable features if license_state is unavailable
  }
}
