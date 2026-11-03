import { headers } from 'next/headers.js';
import { getTenantContext } from '@alga-psa/db';

export * from './lib/portalDomainStatus';
export * from './lib/tenantPortalUrl';
export * from './server/onboardingProgress';
export * from './server/tenantAppBaseUrl';

export async function getTenantForCurrentRequest(fallbackTenant?: string): Promise<string | null> {
  const contextTenant = getTenantContext() ?? null;
  if (contextTenant) {
    return contextTenant;
  }

  const headerValues = await headers();
  const headerTenant = headerValues.get('x-tenant-id');
  if (headerTenant) {
    return headerTenant;
  }

  if (fallbackTenant) {
    return fallbackTenant;
  }

  return null;
}

export function getTenantFromHeaders(headers: Headers): string | null {
  return headers.get('x-tenant-id');
}
