export const TEAMS_INTEGRATION_UI_FLAG = 'teams-integration-ui';

export type TeamsAvailabilityDisabledReason =
  | 'ce_unavailable'
  | 'flag_disabled'
  | 'tenant_not_configured';

export type TeamsAvailability =
  | {
      enabled: true;
      reason: 'enabled';
      flagKey: typeof TEAMS_INTEGRATION_UI_FLAG;
      message?: undefined;
    }
  | {
      enabled: false;
      reason: TeamsAvailabilityDisabledReason;
      flagKey: typeof TEAMS_INTEGRATION_UI_FLAG;
      message: string;
    };

export interface ResolveTeamsAvailabilityInput {
  flagEnabled?: boolean;
  isEnterpriseEdition?: boolean;
  requireTenantContext?: boolean;
  tenantId?: string | null;
}

export interface GetTeamsAvailabilityInput {
  isEnterpriseEdition?: boolean;
  requireTenantContext?: boolean;
  tenantId?: string | null;
  userId?: string | null;
}

export const TEAMS_AVAILABILITY_MESSAGES: Record<TeamsAvailabilityDisabledReason, string> = {
  ce_unavailable: 'Microsoft Teams integration is only available in Enterprise Edition.',
  flag_disabled: 'Microsoft Teams integration is disabled for this tenant.',
  tenant_not_configured: 'Microsoft Teams integration requires tenant context.',
};

export function isTeamsEnterpriseEdition(env: NodeJS.ProcessEnv = process.env): boolean {
  const edition = (env.EDITION ?? '').toLowerCase();
  const publicEdition = (env.NEXT_PUBLIC_EDITION ?? '').toLowerCase();

  return edition === 'ee' || edition === 'enterprise' || publicEdition === 'enterprise';
}

function disabledAvailability(reason: TeamsAvailabilityDisabledReason): TeamsAvailability {
  return {
    enabled: false,
    reason,
    flagKey: TEAMS_INTEGRATION_UI_FLAG,
    message: TEAMS_AVAILABILITY_MESSAGES[reason],
  };
}

// Client-side callers pass `flagEnabled` from useFeatureFlag('teams-integration-ui')
// to drive their own UI gating. Server-side callers should use getTeamsAvailability
// below, which no longer consults any feature flag.
export function resolveTeamsAvailability(input: ResolveTeamsAvailabilityInput = {}): TeamsAvailability {
  const enterpriseEnabled = input.isEnterpriseEdition ?? isTeamsEnterpriseEdition();
  if (!enterpriseEnabled) {
    return disabledAvailability('ce_unavailable');
  }

  if (input.requireTenantContext !== false && !(input.tenantId || '').trim()) {
    return disabledAvailability('tenant_not_configured');
  }

  if (input.flagEnabled === false) {
    return disabledAvailability('flag_disabled');
  }

  return {
    enabled: true,
    reason: 'enabled',
    flagKey: TEAMS_INTEGRATION_UI_FLAG,
  };
}

// Server-side Teams availability. Previously gated by a PostHog flag on top of
// edition + tenant context, but that gate produced false negatives in routes
// whose bundled module graph imported a copy of @alga-psa/core whose module-
// level feature-flag checker had never been registered (registration runs in
// server/src/lib/initializeApp.ts against whichever copy that file imports).
// Tenant-level rollout control is now handled by the client-side UI flag plus
// tier gating in IntegrationsSettingsPage; auth + RBAC still enforce access.
export async function getTeamsAvailability(input: GetTeamsAvailabilityInput = {}): Promise<TeamsAvailability> {
  const enterpriseEnabled = input.isEnterpriseEdition ?? isTeamsEnterpriseEdition();
  const tenantId = (input.tenantId || '').trim();

  if (!enterpriseEnabled) {
    return disabledAvailability('ce_unavailable');
  }

  if (input.requireTenantContext !== false && !tenantId) {
    return disabledAvailability('tenant_not_configured');
  }

  return {
    enabled: true,
    reason: 'enabled',
    flagKey: TEAMS_INTEGRATION_UI_FLAG,
  };
}
