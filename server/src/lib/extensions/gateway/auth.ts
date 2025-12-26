import { NextRequest } from 'next/server';
import { getSession } from 'server/src/lib/auth/getSession';
import { getAdminConnection } from 'server/src/lib/db/admin';

export interface ExtProxyUserInfo {
  user_id: string;
  user_email: string;
  user_name: string;
  user_type: string;
  client_name: string;
}

/**
 * Look up tenant's client_name from the database.
 */
async function getTenantClientName(tenantId: string): Promise<string> {
  try {
    const knex = getAdminConnection();
    const row = await knex('tenants')
      .select('client_name')
      .where('tenant', tenantId)
      .first();
    return row?.client_name || '';
  } catch (error) {
    console.error('[auth] Failed to look up tenant client_name:', error);
    return '';
  }
}

/**
 * Get full user info from session for passing to runner.
 * Returns null if no valid session exists.
 */
export async function getUserInfoFromAuth(req: NextRequest): Promise<ExtProxyUserInfo | null> {
  // Check for internal header first (not typically used for user info)
  const headerTenant = req.headers.get('x-alga-tenant');
  if (headerTenant) {
    // When using header-based auth, we don't have user info
    return null;
  }

  const session = await getSession();
  const user = session?.user as any;

  if (!user) {
    return null;
  }

  // Look up tenant's client_name from database
  const tenantId = user.tenant || '';
  const clientName = tenantId ? await getTenantClientName(tenantId) : '';

  return {
    user_id: user.user_id || user.id || '',
    user_email: user.email || '',
    user_name: user.name || user.username || '',
    user_type: user.user_type || 'internal',
    client_name: clientName,
  };
}

export async function getTenantFromAuth(req: NextRequest): Promise<string> {
  // Minimal scaffolding:
  // - Prefer internal header `x-alga-tenant` (e.g., set by edge/auth middleware)
  // - Fallback to DEV_TENANT_ID for local development
  // - Otherwise, reject (to avoid running as a fake tenant)
  const h = req.headers.get('x-alga-tenant');
  if (h && h.trim()) return h.trim();

  // Accept legacy header used by admin/publishing clients.
  const legacy = req.headers.get('x-tenant-id');
  if (legacy && legacy.trim()) return legacy.trim();

  const session = await getSession();
  const sessionTenant = (session?.user as any)?.tenant;
  if (sessionTenant && String(sessionTenant).trim()) {
    return String(sessionTenant).trim();
  }

  const dev = process.env.DEV_TENANT_ID;
  if (dev && dev.trim()) return dev.trim();
  throw new Error('unauthenticated');
}

export async function assertAccess(_tenantId: string, _extensionId: string, _method: string, _path: string): Promise<void> {
  // TODO: implement RBAC and per-tenant endpoint checks
  return;
}
