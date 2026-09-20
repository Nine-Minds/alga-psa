import type { TelephonyProviderKind } from '@alga-psa/telephony/types';

/**
 * Server-only EE dispatch for the telephony providers. Import this from the
 * telephony server actions (or other server code) only: the loaders reach the
 * EE modules, which pull route handlers, ingest services and @alga-psa/db —
 * none of which may enter a client bundle. Client components read the
 * client-safe metadata in providerRegistry.ts instead.
 *
 * One provider adapter across the telephony class. Each EE module names its
 * lifecycle functions after its own vendor (activateTeamsPhoneProvider,
 * activateThreecxProvider); the loader normalizes them to this shape so the
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

const EE_LOADERS: Record<TelephonyProviderKind, () => Promise<TelephonyProviderEeAdapter>> = {
  'teams-phone': async () => {
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
  '3cx': async () => {
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

/** Loads the provider's EE module, normalized to the adapter interface. */
export function loadTelephonyProviderEe(
  provider: TelephonyProviderKind,
): Promise<TelephonyProviderEeAdapter> {
  return EE_LOADERS[provider]();
}
