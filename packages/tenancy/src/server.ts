import { headers } from 'next/headers';
import { getTenantContext } from '@alga-psa/db';

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

