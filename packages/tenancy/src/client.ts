import { getSession } from 'next-auth/react';

/**
 * Client-side function to get current tenant from session.
 * Throws if no tenant is found (for use in authenticated contexts).
 */
export async function getCurrentTenantOrThrow(): Promise<string> {
  const session = await getSession();
  if (!session?.user?.tenant) {
    throw new Error('No tenant found in session');
  }
  return session.user.tenant;
}

/**
 * @deprecated Use getCurrentTenantOrThrow instead. This is kept for backwards compatibility.
 */
export const getCurrentTenant = getCurrentTenantOrThrow;

