import { isFeatureFlagEnabled } from '@alga-psa/core';

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
  evaluateFlag?: typeof isFeatureFlagEnabled;
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

export function resolveTeamsAvailability(input: ResolveTeamsAvailabilityInput = {}): TeamsAvailability {
  const enterpriseEnabled = input.isEnterpriseEdition ?? isTeamsEnterpriseEdition();
  if (!enterpriseEnabled) {
    return disabledAvailability('ce_unavailable');
  }

  if (input.requireTenantContext !== false && !(input.tenantId || '').trim()) {
    return disabledAvailability('tenant_not_configured');
  }

  if (!input.flagEnabled) {
    return disabledAvailability('flag_disabled');
  }

  return {
    enabled: true,
    reason: 'enabled',
    flagKey: TEAMS_INTEGRATION_UI_FLAG,
  };
}

export async function getTeamsAvailability(input: GetTeamsAvailabilityInput = {}): Promise<TeamsAvailability> {
  const enterpriseEnabled = input.isEnterpriseEdition ?? isTeamsEnterpriseEdition();
  const tenantId = (input.tenantId || '').trim();

  if (!enterpriseEnabled) {
    return disabledAvailability('ce_unavailable');
  }

  if (input.requireTenantContext !== false && !tenantId) {
    return disabledAvailability('tenant_not_configured');
  }

  const evaluateFlag = input.evaluateFlag ?? isFeatureFlagEnabled;

  try {
    const flagEnabled = await evaluateFlag(TEAMS_INTEGRATION_UI_FLAG, {
      tenantId: tenantId || undefined,
      userId: (input.userId || '').trim() || undefined,
    });

    return resolveTeamsAvailability({
      flagEnabled,
      isEnterpriseEdition: enterpriseEnabled,
      requireTenantContext: input.requireTenantContext,
      tenantId,
    });
  } catch {
    return disabledAvailability('flag_disabled');
  }
}
