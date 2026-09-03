import { RELEASE_V1_6_FEATURE_FLAG } from '@alga-psa/core/features';
import { TIER_FEATURES } from '@alga-psa/types';
import { TELEPHONY_PROVIDERS } from '@alga-psa/telephony/types';
import type { TelephonyProviderKind } from '@alga-psa/telephony/types';

/**
 * Client-safe provider metadata only. The settings cards render from this
 * registry, so it must never reference an EE module — even a dynamic import
 * here lands the EE graph (route handlers, ingest services, the db package)
 * in the browser bundle. The per-provider EE loaders live in
 * providerEeLoader.ts, imported from the server actions alone.
 */
export interface TelephonyProviderRegistryEntry {
  id: TelephonyProviderKind;
  /** i18n key for the card title. */
  labelKey: string;
  /** i18n key for the card description. */
  descriptionKey: string;
  /** Tier feature required beyond the class-wide edition gate, or null. */
  requiresTierFeature: TIER_FEATURES | null;
  /** Release flag that gates the settings card only, or null. */
  releaseFlag: string | null;
}

const TEAMS_PHONE_ENTRY: TelephonyProviderRegistryEntry = {
  id: 'teams-phone',
  labelKey: 'integrations.telephony.providers.teamsPhone.label',
  descriptionKey: 'integrations.telephony.providers.teamsPhone.description',
  requiresTierFeature: null,
  releaseFlag: null,
};

const THREECX_ENTRY: TelephonyProviderRegistryEntry = {
  id: '3cx',
  labelKey: 'integrations.telephony.providers.threecx.label',
  descriptionKey: 'integrations.telephony.providers.threecx.description',
  requiresTierFeature: TIER_FEATURES.PBX_TELEPHONY,
  releaseFlag: RELEASE_V1_6_FEATURE_FLAG,
};

const REGISTRY: Record<TelephonyProviderKind, TelephonyProviderRegistryEntry> = {
  'teams-phone': TEAMS_PHONE_ENTRY,
  '3cx': THREECX_ENTRY,
};

/** One entry per TELEPHONY_PROVIDERS value, in declaration order. */
export const TELEPHONY_PROVIDER_REGISTRY: TelephonyProviderRegistryEntry[] =
  TELEPHONY_PROVIDERS.map((id) => REGISTRY[id]);

export function getTelephonyProviderRegistryEntry(
  provider: string,
): TelephonyProviderRegistryEntry | undefined {
  return TELEPHONY_PROVIDER_REGISTRY.find((entry) => entry.id === provider);
}
