import { NextRequest } from 'next/server';
import { getSession } from '@alga-psa/auth';
import { tenantDb } from '@alga-psa/db';
import { getAdminConnection } from '@alga-psa/db/admin';

export interface ExtProxyUserInfo {
  user_id: string;
  user_email: string;
  user_name: string;
  user_type: string;
  client_name: string;
  /** For client portal users, the client_id they are associated with */
  client_id?: string;
}

/**
 * Look up tenant's client_name from the database.
 */
async function getTenantClientName(tenantId: string): Promise<string> {
  try {
    const knex = await getAdminConnection();
    const row = await tenantDb(knex, tenantId).table('tenants')
      .select('client_name')
      .first();
    return row?.client_name || '';
  } catch (error) {
    console.error('[auth] Failed to look up tenant client_name:', error);
    return '';
  }
}

/**
 * Look up user's client_id from their contact association.
 * Returns undefined if user doesn't have a contact or contact doesn't have a client.
 * Throws on database errors to allow caller to handle appropriately.
 */
async function getUserClientId(userId: string, tenantId: string): Promise<string | undefined> {
  const knex = await getAdminConnection();
  const db = tenantDb(knex, tenantId);
  const query = db.table('users as u')
    .select('c.client_id')
    .where('u.user_id', userId);
  const result = await db
    .tenantJoin(query, 'contacts as c', 'c.contact_name_id', 'u.contact_id')
    .first();

  return result?.client_id || undefined;
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
    console.log('[ext-proxy auth] Skipping user info - x-alga-tenant header present');
    return null;
  }

  const session = await getSession();
  const user = session?.user as any;

  console.log('[ext-proxy auth] Session check', {
    hasSession: !!session,
    hasUser: !!user,
    userId: user?.user_id || user?.id,
    userEmail: user?.email,
  });

  if (!user) {
    return null;
  }

  // Look up tenant's client_name from database
  const tenantId = user.tenant || '';
  const clientName = tenantId ? await getTenantClientName(tenantId) : '';

  // Look up user's client_id if they are a client portal user
  const userId = user.user_id || user.id || '';
  const userType = user.user_type || 'internal';
  const clientId = (userType === 'client' && userId && tenantId)
    ? await getUserClientId(userId, tenantId)
    : undefined;

  const userInfo: ExtProxyUserInfo = {
    user_id: userId,
    user_email: user.email || '',
    user_name: user.name || user.username || '',
    user_type: userType,
    client_name: clientName,
    client_id: clientId,
  };

  console.log('[ext-proxy auth] Returning user info', {
    userId: userInfo.user_id,
    userEmail: userInfo.user_email,
    userName: userInfo.user_name,
    userType: userInfo.user_type,
    clientId: userInfo.client_id,
  });

  return userInfo;
}

export async function getTenantFromAuth(req: NextRequest): Promise<string> {
  const session = await getSession();
  const sessionTenant = (session?.user as any)?.tenant;
  const h = req.headers.get('x-alga-tenant')?.trim();
  const legacy = req.headers.get('x-tenant-id')?.trim();

  if (sessionTenant && String(sessionTenant).trim()) {
    const tenant = String(sessionTenant).trim();
    if ((h && h !== tenant) || (legacy && legacy !== tenant)) {
      throw new Error('tenant_mismatch');
    }
    return tenant;
  }

  // Header-based tenant selection is only allowed for non-browser/internal callers
  // that do not already have a session tenant. A browser user must never be able
  // to switch tenants by supplying x-alga-tenant/x-tenant-id.
  if (h) return h;
  if (legacy) return legacy;

  const dev = process.env.DEV_TENANT_ID;
  if (dev && dev.trim()) return dev.trim();
  throw new Error('unauthenticated');
}

export async function assertAccess(_tenantId: string, _extensionId: string, _method: string, _path: string): Promise<void> {
  // TODO: implement RBAC and per-tenant endpoint checks
  return;
}
