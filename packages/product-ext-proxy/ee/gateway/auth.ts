import { NextRequest } from 'next/server';
import { getSession } from '@alga-psa/auth';
import { getAdminConnection } from '@alga-psa/db/admin';

export interface ExtProxyUserInfo {
  user_id: string;
  user_email: string;
  user_name: string;
  user_type: string;
  client_name: string;
  /** For client portal users, the client_id they are associated with */
  client_id?: string;
  /** Optional map of additional user attributes. */
  additional_fields?: Record<string, string>;
}

interface UserClientContext {
  userType?: string;
  contactId?: string;
  clientId?: string;
}

function toNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function addScalarField(
  target: Record<string, string>,
  source: Record<string, unknown>,
  key: string,
): void {
  const value = source[key];
  if (value === undefined || value === null) return;
  if (typeof value === 'string') {
    if (value.length > 0) target[key] = value;
    return;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    target[key] = String(value);
  }
}

function extractAdditionalFields(
  user: Record<string, unknown>,
  fallback?: { contactId?: string }
): Record<string, string> {
  const fields: Record<string, string> = {};
  addScalarField(fields, user, 'contact_id');
  addScalarField(fields, user, 'contactId');
  addScalarField(fields, user, 'username');
  addScalarField(fields, user, 'locale');
  addScalarField(fields, user, 'timezone');
  if (!fields.contact_id && fallback?.contactId) {
    fields.contact_id = fallback.contactId;
  }
  if (!fields.contactId && fallback?.contactId) {
    fields.contactId = fallback.contactId;
  }
  return fields;
}

/**
 * Look up tenant's client_name from the database.
 */
async function getTenantClientName(tenantId: string): Promise<string> {
  try {
    const knex = await getAdminConnection();
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
 * Look up user's client_id from their contact association.
 * Returns undefined if user doesn't have a contact or contact doesn't have a client.
 */
async function getUserClientId(userId: string, tenantId: string): Promise<string | undefined> {
  try {
    const knex = await getAdminConnection();
    // First get the user's contact_id, then look up the client_id from contacts
    const user = await knex('users')
      .select('contact_id')
      .where('user_id', userId)
      .where('tenant', tenantId)
      .first();

    if (!user?.contact_id) {
      return undefined;
    }

    const contact = await knex('contacts')
      .select('client_id')
      .where('contact_name_id', user.contact_id)
      .where('tenant', tenantId)
      .first();

    return contact?.client_id || undefined;
  } catch (error) {
    console.error('[auth] Failed to look up user client_id:', error);
    return undefined;
  }
}

/**
 * Resolve authoritative user_type/contact_id/client_id from the database.
 * This is a fallback for cases where session claims are incomplete.
 */
async function getUserClientContext(userId: string, tenantId: string): Promise<UserClientContext> {
  try {
    const knex = await getAdminConnection();
    const row = await knex('users as u')
      .leftJoin('contacts as c', function () {
        this.on('c.contact_name_id', '=', 'u.contact_id')
          .andOn('c.tenant', '=', 'u.tenant');
      })
      .select('u.user_type', 'u.contact_id', 'c.client_id')
      .where('u.user_id', userId)
      .andWhere('u.tenant', tenantId)
      .first();

    return {
      userType: toNonEmptyString(row?.user_type),
      contactId: toNonEmptyString(row?.contact_id),
      clientId: toNonEmptyString(row?.client_id),
    };
  } catch (error) {
    console.error('[auth] Failed to resolve user client context:', error);
    return {};
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
    console.log('[ext-proxy auth] Skipping user info - x-alga-tenant header present');
    return null;
  }

  const session = await getSession();
  const user = session?.user as any;
  const userRecord = (user ?? {}) as Record<string, unknown>;

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

  // Use the client ID carried in the auth token/session when available.
  // This is the most reliable source for client portal sessions.
  const sessionClientId =
    toNonEmptyString(userRecord.client_id) ??
    toNonEmptyString(userRecord.clientId);

  const sessionUserType =
    toNonEmptyString(userRecord.user_type) ??
    toNonEmptyString(userRecord.userType);

  const sessionContactId =
    toNonEmptyString(userRecord.contact_id) ??
    toNonEmptyString(userRecord.contactId);

  // Fall back to DB lookup when session claims are missing/incomplete.
  const userId = user.user_id || user.id || '';
  const needsDbContext =
    Boolean(userId && tenantId) &&
    (!sessionClientId || !sessionUserType || !sessionContactId);
  const dbContext = needsDbContext
    ? await getUserClientContext(userId, tenantId)
    : {};

  const userType = sessionUserType || dbContext.userType || 'internal';
  const clientId =
    sessionClientId ||
    ((userType === 'client' && userId && tenantId)
      ? (dbContext.clientId || await getUserClientId(userId, tenantId))
      : undefined);

  const userInfo: ExtProxyUserInfo = {
    user_id: userId,
    user_email: user.email || '',
    user_name: user.name || user.username || '',
    user_type: userType,
    client_name: clientName,
    client_id: clientId,
    additional_fields: extractAdditionalFields(userRecord, {
      contactId: dbContext.contactId,
    }),
  };

  console.log('[ext-proxy auth] Returning user info', {
    userId: userInfo.user_id,
    userEmail: userInfo.user_email,
    userName: userInfo.user_name,
    userType: userInfo.user_type,
    clientId: userInfo.client_id,
    usedDbFallback: needsDbContext,
  });

  return userInfo;
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
