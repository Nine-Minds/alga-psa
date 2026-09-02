import { RELEASE_V1_6_FEATURE_FLAG } from '@alga-psa/core/features';
import { TIER_FEATURES } from '@alga-psa/types';
import { TELEPHONY_PROVIDERS } from '@alga-psa/telephony/types';
import type { TelephonyProviderKind } from '@alga-psa/telephony/types';

/**
 * One provider adapter across the telephony class. Each EE module names its
 * lifecycle functions after its own vendor (activateTeamsPhoneProvider,
 * activateThreecxProvider); the registry normalizes them to this shape so the
 * server actions dispatch by provider without naming any one vendor.
 */
export interface TelephonyProviderStateSummary {
  provider: string;
  status: 'not_configured' | 'active' | 'disabled' | 'error';
  autoCreateTickets: boolean;
  subscriptionId: string | null;
  subscriptionExpiresAt: string | null;
  lastError: string | null;
  lastNotificationAt: string | null;
  prerequisiteMet: boolean;
}

export interface TelephonyProviderEeAdapter {
  getProviderState(tenantId: string): Promise<TelephonyProviderStateSummary>;
  activateProvider(tenantId: string): Promise<unknown>;
  deactivateProvider(tenantId: string): Promise<unknown>;
  setAutoCreateTickets(tenantId: string, autoCreateTickets: boolean): Promise<unknown>;
}

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
  /** Loads the provider's EE module, normalized to the adapter interface. */
  loadEe: () => Promise<TelephonyProviderEeAdapter>;
}

const TEAMS_PHONE_ENTRY: TelephonyProviderRegistryEntry = {
  id: 'teams-phone',
  labelKey: 'integrations.telephony.providers.teamsPhone.label',
  descriptionKey: 'integrations.telephony.providers.teamsPhone.description',
  requiresTierFeature: null,
  releaseFlag: null,
  loadEe: async () => {
    const mod: any = await import('@alga-psa/ee-microsoft-teams/lib');
    return {
      getProviderState: async (tenantId: string) => {
        const state = await mod.getTeamsPhoneProviderState(tenantId);
        return {
          provider: state.provider,
          status: state.status,
          autoCreateTickets: Boolean(state.autoCreateTickets),
          subscriptionId: state.subscriptionId ?? null,
          subscriptionExpiresAt: state.subscriptionExpiresAt ?? null,
          lastError: state.lastError ?? null,
          lastNotificationAt: state.lastNotificationAt ?? null,
          prerequisiteMet: Boolean(state.teamsConfigured),
        };
      },
      activateProvider: (tenantId: string) => mod.activateTeamsPhoneProvider(tenantId),
      deactivateProvider: (tenantId: string) => mod.deactivateTeamsPhoneProvider(tenantId),
      setAutoCreateTickets: (tenantId: string, autoCreateTickets: boolean) =>
        mod.setTeamsPhoneAutoTicketPolicy(tenantId, autoCreateTickets),
    };
  },
};

const THREECX_ENTRY: TelephonyProviderRegistryEntry = {
  id: '3cx',
  labelKey: 'integrations.telephony.providers.threecx.label',
  descriptionKey: 'integrations.telephony.providers.threecx.description',
  requiresTierFeature: TIER_FEATURES.PBX_TELEPHONY,
  releaseFlag: RELEASE_V1_6_FEATURE_FLAG,
  loadEe: async () => {
    const mod: any = await import('@alga-psa/ee-threecx/lib');
    return {
      getProviderState: async (tenantId: string) => {
        const state = await mod.getThreecxProviderState(tenantId);
        return {
          provider: '3cx',
          status: state.status,
          autoCreateTickets: Boolean(state.autoCreateTickets),
          subscriptionId: null,
          subscriptionExpiresAt: null,
          lastError: null,
          lastNotificationAt: null,
          prerequisiteMet: true,
        };
      },
      activateProvider: (tenantId: string) => mod.activateThreecxProvider(tenantId),
      deactivateProvider: (tenantId: string) => mod.deactivateThreecxProvider(tenantId),
      setAutoCreateTickets: (tenantId: string, autoCreateTickets: boolean) =>
        mod.setThreecxAutoCreateTickets(tenantId, autoCreateTickets),
    };
  },
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
