import type { OnboardingProgressStatus } from '../lib/deriveParentStepFromSubsteps';

export interface CalendarProviderRow {
  id: string;
  tenant: string;
  user_id: string | null;
  provider_type: 'google' | 'microsoft';
  provider_name: string;
  calendar_id: string;
  is_active: boolean;
  sync_direction: 'bidirectional' | 'to_external' | 'from_external';
  status: 'connected' | 'disconnected' | 'error' | 'configuring';
  last_sync_at: string | Date | null;
  error_message: string | null;
  vendor_config: unknown;
  created_at: string | Date;
  updated_at: string | Date;
}

interface CalendarProviderMetadata {
  id: string;
  name: string;
  status: CalendarProviderRow['status'];
}

export interface CalendarProviderOnboardingSummary {
  hasProvider: boolean;
  connectionStatus: OnboardingProgressStatus;
  lastUpdated: string | Date | null;
  blocker: string | null;
  blockerKey: string | null;
  blockerValues?: Record<string, unknown>;
  providers: CalendarProviderMetadata[];
}

export function summarizeCalendarProviders(
  providers: CalendarProviderRow[],
): CalendarProviderOnboardingSummary {
  const connected = providers.filter(
    (provider) => provider.is_active && provider.status === 'connected',
  );
  const errored = providers.find((provider) => provider.status === 'error');
  const hasProvider = providers.length > 0;
  const fallbackBlocker = errored
    ? `${errored.provider_name} requires attention before syncing can resume.`
    : null;

  return {
    hasProvider,
    connectionStatus: connected.length > 0
      ? 'complete'
      : errored
        ? 'blocked'
        : hasProvider
          ? 'in_progress'
          : 'not_started',
    lastUpdated: connected[0]?.updated_at ?? providers[0]?.updated_at ?? null,
    blocker: errored?.error_message || fallbackBlocker,
    blockerKey: errored && !errored.error_message
      ? 'onboarding.blockers.calendar.providerAttention'
      : null,
    blockerValues: errored && !errored.error_message
      ? { provider: errored.provider_name }
      : undefined,
    providers: providers.map((provider) => ({
      id: provider.id,
      name: provider.provider_name,
      status: provider.status,
    })),
  };
}
