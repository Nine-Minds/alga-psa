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
  return resolveTelephonyAvailability(input);
}

export interface GetTelephonyProviderAvailabilityInput extends GetTelephonyAvailabilityInput {
  /** Injectable for tests; defaults to @alga-psa/licensing resolveTenantTier. */
  resolveTier?: (tenantId: string) => Promise<TenantTier>;
}

const PROVIDER_TIER_FEATURES: Partial<Record<TelephonyProviderKind, TIER_FEATURES>> = {
  '3cx': TIER_FEATURES.PBX_TELEPHONY,
};

/**
 * Per-provider entitlement on top of the class-wide edition/tenant checks.
 * Tier only — the release flag gates nothing but the settings card, so this
 * helper (used by routes, actions and the job handler) never reads it.
 */
export async function getTelephonyProviderAvailability(
  provider: TelephonyProviderKind,
  input: GetTelephonyProviderAvailabilityInput = {},
): Promise<TelephonyAvailability> {
  const base = resolveTelephonyAvailability(input);
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
