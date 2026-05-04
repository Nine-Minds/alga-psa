export type TeamsAvailabilityDisabledReason =
  | 'ce_unavailable'
  | 'tenant_not_configured';

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

export interface GetTeamsAvailabilityInput {
  isEnterpriseEdition?: boolean;
  requireTenantContext?: boolean;
  tenantId?: string | null;
  userId?: string | null;
}

export const TEAMS_AVAILABILITY_MESSAGES: Record<TeamsAvailabilityDisabledReason, string> = {
  ce_unavailable: 'Microsoft Teams integration is only available in Enterprise Edition.',
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

  return {
    enabled: true,
    reason: 'enabled',
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

  return {
    enabled: true,
    reason: 'enabled',
  };
}
