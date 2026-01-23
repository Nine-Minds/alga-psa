'use server';

import { getTenantForCurrentRequest } from '../../server';
import { getPortalDomainStatusForTenant } from '../../server/portalDomainStatus';
import { getCurrentUser } from '@alga-psa/users/actions';
import type {
  PortalDomainStatusResponse,
  PortalDomainRegistrationRequest,
  PortalDomainRegistrationResult,
} from './portalDomain.types';

export async function getPortalDomainStatusAction(): Promise<PortalDomainStatusResponse> {
  // First try to get tenant from user session (works in client component effects)
  const user = await getCurrentUser();
  if (user?.tenant) {
    return getPortalDomainStatusActionForTenant(user.tenant);
  }

  // Fallback to request-based tenant resolution
  const requestTenant = await getTenantForCurrentRequest();
  return getPortalDomainStatusActionForTenant(requestTenant ?? undefined);
}

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
