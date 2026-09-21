import { assertPsaOnlyTenantAccess, ProductAccessError } from '@shared/services/productAccessGuard';
import { TIER_FEATURES, tierHasFeature } from '@alga-psa/types';
import type { TenantTier } from '@alga-psa/types';
import type { TelephonyProviderKind } from '@alga-psa/telephony/types';
import {
  disabledTelephonyAvailability,
  resolveTelephonyAvailability,
} from './telephonyAvailabilityCore';
import type {
  GetTelephonyAvailabilityInput,
  TelephonyAvailability,
} from './telephonyAvailabilityCore';

export {
  isTelephonyEnterpriseEdition,
  resolveTelephonyAvailability,
  TELEPHONY_AVAILABILITY_MESSAGES,
} from './telephonyAvailabilityCore';
export type {
  GetTelephonyAvailabilityInput,
  ResolveTelephonyAvailabilityInput,
  TelephonyAvailability,
  TelephonyAvailabilityDisabledReason,
} from './telephonyAvailabilityCore';

export async function getTelephonyAvailability(
  input: GetTelephonyAvailabilityInput = {},
): Promise<TelephonyAvailability> {
  const availability = resolveTelephonyAvailability(input);
  if (!availability.enabled || !input.tenantId?.trim()) return availability;
  try { await assertPsaOnlyTenantAccess(input.tenantId, 'telephony_integration'); }
  catch (error) {
    if (error instanceof ProductAccessError) return disabledTelephonyAvailability('product_unavailable');
    throw error;
  }
  return availability;
}

export interface GetTelephonyProviderAvailabilityInput extends GetTelephonyAvailabilityInput {
  /** Injectable for tests; defaults to @alga-psa/licensing resolveTenantTier. */
  resolveTier?: (tenantId: string) => Promise<TenantTier>;
}

const PROVIDER_TIER_FEATURES: Partial<Record<TelephonyProviderKind, TIER_FEATURES>> = {
  '3cx': TIER_FEATURES.PBX_TELEPHONY,
};

/**
 * Per-provider entitlement on top of the class-wide edition/tenant/product checks.
 * Tier only — the release flag gates nothing but the settings card, so this
 * helper (used by routes, actions and the job handler) never reads it.
 */
export async function getTelephonyProviderAvailability(
  provider: TelephonyProviderKind,
  input: GetTelephonyProviderAvailabilityInput = {},
): Promise<TelephonyAvailability> {
  // Precedence: product admission outranks commercial tier. The base call is
  // getTelephonyAvailability (not the bare resolver) so `product_unavailable`
  // short-circuits before any tier lookup — a tenant whose product excludes
  // telephony must never be told to "upgrade to Pro" for a feature it cannot buy,
  // and the tier lookup must not run for a tenant that failed product admission.
  const base = await getTelephonyAvailability(input);
  if (!base.enabled) {
    return base;
  }

  const tierFeature = PROVIDER_TIER_FEATURES[provider];
  if (!tierFeature) {
    return base;
  }

  const tenantId = (input.tenantId ?? '').trim();
  if (!tenantId) {
    return disabledTelephonyAvailability('tenant_not_configured');
  }

  const resolveTier = input.resolveTier
    ?? (await import('@alga-psa/licensing')).resolveTenantTier;
  const tier = await resolveTier(tenantId);
  if (!tierHasFeature(tier, tierFeature)) {
    return disabledTelephonyAvailability('tier_required');
  }

  return base;
}
