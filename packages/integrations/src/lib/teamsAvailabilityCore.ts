export type TeamsAvailabilityDisabledReason =
  | 'ce_unavailable'
  | 'tenant_not_configured'
  | 'addon_required';

export type TeamsAvailability =
  | {
      enabled: true;
      reason: 'enabled';
      message?: undefined;
    }
  | {
      enabled: false;
      reason: TeamsAvailabilityDisabledReason;
      message: string;
    };

export interface ResolveTeamsAvailabilityInput {
  isEnterpriseEdition?: boolean;
  requireTenantContext?: boolean;
  tenantId?: string | null;
}

export interface GetTeamsAvailabilityInput extends ResolveTeamsAvailabilityInput {
  userId?: string | null;
}

export const TEAMS_AVAILABILITY_MESSAGES: Record<TeamsAvailabilityDisabledReason, string> = {
  ce_unavailable: 'Microsoft Teams integration is only available in Enterprise Edition.',
  tenant_not_configured: 'Microsoft Teams integration requires tenant context.',
  addon_required: 'Microsoft Teams integration requires the Teams add-on.',
};

type TeamsEditionEnv = {
  EDITION?: string;
  NEXT_PUBLIC_EDITION?: string;
  [key: string]: string | undefined;
};

function getRuntimeEnv(): TeamsEditionEnv {
  return typeof process === 'undefined' ? {} : process.env;
}

export function isTeamsEnterpriseEdition(env: TeamsEditionEnv = getRuntimeEnv()): boolean {
  const edition = (env.EDITION ?? '').toLowerCase();
  const publicEdition = (env.NEXT_PUBLIC_EDITION ?? '').toLowerCase();

  return edition === 'ee' || edition === 'enterprise' || publicEdition === 'enterprise';
}

export function disabledTeamsAvailability(reason: TeamsAvailabilityDisabledReason): TeamsAvailability {
  return {
    enabled: false,
    reason,
    message: TEAMS_AVAILABILITY_MESSAGES[reason],
  };
}

export function resolveTeamsAvailability(input: ResolveTeamsAvailabilityInput = {}): TeamsAvailability {
  const enterpriseEnabled = input.isEnterpriseEdition ?? isTeamsEnterpriseEdition();
  if (!enterpriseEnabled) {
    return disabledTeamsAvailability('ce_unavailable');
  }

  if (input.requireTenantContext !== false && !(input.tenantId || '').trim()) {
    return disabledTeamsAvailability('tenant_not_configured');
  }

  return {
    enabled: true,
    reason: 'enabled',
  };
}
