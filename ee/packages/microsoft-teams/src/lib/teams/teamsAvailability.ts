import { assertPsaOnlyTenantAccess, ProductAccessError } from '@shared/services/productAccessGuard';
export type TeamsAvailabilityDisabledReason =
  | 'ce_unavailable'
  | 'tenant_not_configured'
  | 'feature_disabled'
  | 'product_unavailable';

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
  feature_disabled: 'Microsoft Teams integration is not enabled for this tenant.',
  product_unavailable: 'Microsoft Teams integration is not available for this product.',
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
  const availability = resolveTeamsAvailability(input);
  if (!availability.enabled || !input.tenantId?.trim()) return availability;
  try { await assertPsaOnlyTenantAccess(input.tenantId, 'teams_integration'); }
  catch (error) {
    if (error instanceof ProductAccessError) return disabledAvailability('product_unavailable');
    throw error;
  }
  return availability;
}
