'use server';

import { getTenantForCurrentRequest } from '../../server';
import { getPortalDomainStatusForTenant } from '../../server/portalDomainStatus';
import { withOptionalAuth, type AuthContext } from '@alga-psa/auth';
import type { IUserWithRoles } from '@alga-psa/types';
import type {
  PortalDomainStatusResponse,
  PortalDomainRegistrationRequest,
  PortalDomainRegistrationResult,
} from './portalDomain.types';

export const getPortalDomainStatusAction = withOptionalAuth(async (user: IUserWithRoles | null, ctx: AuthContext | null): Promise<PortalDomainStatusResponse> => {
  // First try to get tenant from user session (works in client component effects)
  if (user && ctx?.tenant) {
    return getPortalDomainStatusActionForTenant(ctx.tenant);
  }

  // Fallback to request-based tenant resolution
  const requestTenant = await getTenantForCurrentRequest();
  return getPortalDomainStatusActionForTenant(requestTenant ?? undefined);
});

export async function getPortalDomainStatusActionForTenant(
  tenantId?: string
): Promise<PortalDomainStatusResponse> {
  if (!tenantId) {
    throw new Error('Tenant context is required to read portal domain status');
  }

  return getPortalDomainStatusForTenant(tenantId);
}

export async function requestPortalDomainRegistrationAction(
  _request: PortalDomainRegistrationRequest
): Promise<PortalDomainRegistrationResult> {
  throw new Error('Custom portal domains are only available in the Enterprise edition.');
}

export async function refreshPortalDomainStatusAction(): Promise<PortalDomainStatusResponse> {
  return getPortalDomainStatusAction();
}

export async function disablePortalDomainAction(): Promise<PortalDomainStatusResponse> {
  throw new Error('Custom portal domains are only available in the Enterprise edition.');
}
