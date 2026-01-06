// server/src/lib/tenant.ts
import { headers } from 'next/headers';

export async function getTenantForCurrentRequest(fallbackTenant?: string): Promise<string | null> {
  const headerValues = await headers();
  const headerTenant = headerValues.get('x-tenant-id');
  if (headerTenant) {
    return headerTenant;
  }

  try {
    const { auth } = await import('../app/api/auth/[...nextauth]/edge-auth');
    const session = await auth();
    const sessionTenant = (session?.user as any)?.tenant;
    if (sessionTenant) {
      return sessionTenant;
    }
  } catch (error) {
    // Don't fail the request just because auth cookies can't be decrypted (e.g. secret rotated, stale cookies).
    console.error('Error retrieving tenant from session:', error);
  }

  if (fallbackTenant) {
    console.warn('Session tenant not found, using fallback tenant');
    return fallbackTenant;
  }

  return null;
}

export function getTenantFromHeaders(headers: Headers): string | null {
    return headers.get('x-tenant-id');
}
