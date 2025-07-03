// server/src/lib/tenant.ts
import { getServerSession } from 'next-auth/next';
import { options } from '../app/api/auth/[...nextauth]/options';
import { headers } from 'next/headers';

export async function getTenantForCurrentRequest(fallbackTenant?: string): Promise<string | null> {
    try {
        const headerValues = await headers();
        if (headerValues.get('x-tenant-id')) {
            return headerValues.get('x-tenant-id') as string;
        }

        const session = await getServerSession(options);
        if (session?.user?.tenant) {
            return session.user.tenant;
        }

        if (fallbackTenant) {
            console.warn('Session tenant not found, using fallback tenant');
            return fallbackTenant;
        }

        // If we reach here, we couldn't get the tenant from the session or fallback
        return null;
    } catch (error) {
        console.error('Error retrieving tenant:', error);
        throw new Error('Failed to retrieve tenant information');
    }
}

export function getTenantFromHeaders(headers: Headers): string | null {
    return headers.get('x-tenant-id');
}
