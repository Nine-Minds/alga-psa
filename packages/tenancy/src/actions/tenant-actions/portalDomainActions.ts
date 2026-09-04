'use server';

import { getTenantForCurrentRequest } from '../../server';
import { getPortalDomainStatusForTenant } from '../../server/portalDomainStatus';
import { withOptionalAuth, type AuthContext } from '@alga-psa/auth';
import type { IUserWithRoles } from '@alga-psa/types';
import type { PortalDomainStatusResponse } from './portalDomain.types';

// Read-only status for package consumers (client portal branding). The editable
// lifecycle (register, refresh, retry, disable) lives in
// server/src/lib/actions/tenant-actions and works in every edition.

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
