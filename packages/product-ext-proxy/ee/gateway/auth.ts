import { NextRequest } from 'next/server';
import { getSession } from '@alga-psa/auth';
import { tenantDb } from '@alga-psa/db';
import { getAdminConnection } from '@alga-psa/db/admin';

export {
  assertAccess,
  ExtensionGatewayAccessError,
} from './access';
export type {
  AssertExtensionAccessInput,
  AuthorizedExtensionAccess,
  ExtensionGatewayAccessErrorCode,
  ExtensionGatewayPrincipal,
} from './access';

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

function extractAdditionalFields(user: Record<string, unknown>): Record<string, string> {
  const fields: Record<string, string> = {};
  addScalarField(fields, user, 'contact_id');
  addScalarField(fields, user, 'contactId');
  addScalarField(fields, user, 'username');
  addScalarField(fields, user, 'locale');
  addScalarField(fields, user, 'timezone');
  return fields;
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
 */
async function getUserClientId(userId: string, tenantId: string): Promise<string | undefined> {
  try {
    const knex = await getAdminConnection();
    const db = tenantDb(knex, tenantId);
    // First get the user's contact_id, then look up the client_id from contacts
    const user = await db.table('users')
      .select('contact_id')
      .where('user_id', userId)
      .first();

    if (!user?.contact_id) {
      return undefined;
    }

    const contact = await db.table('contacts')
      .select('client_id')
      .where('contact_name_id', user.contact_id)
      .first();

    return contact?.client_id || undefined;
  } catch (error) {
    console.error('[auth] Failed to look up user client_id:', error);
    return undefined;
  }
}

/**
 * Get full user info from session for passing to runner.
 * Returns null if no valid session exists.
 *
 * User context is session-driven. A tenant header's presence is not treated as
 * internal-caller proof and never suppresses the authenticated user.
 */
export async function getUserInfoFromAuth(req: NextRequest): Promise<ExtProxyUserInfo | null> {
  const session = await getSession();
  const user = session?.user as any;

  if (!user) {
    return null;
  }

  // Look up tenant's client_name from database
  const tenantId = user.tenant || '';
  const clientName = tenantId ? await getTenantClientName(tenantId) : '';

  // Use the client ID carried in the auth token/session when available.
  // This is the most reliable source for client portal sessions.
  const sessionClientId =
    toNonEmptyString((user as Record<string, unknown>).client_id) ??
    toNonEmptyString((user as Record<string, unknown>).clientId);

  // Fall back to DB lookup only when needed.
  const userId = user.user_id || user.id || '';
  const userType = user.user_type || user.userType || 'internal';
  const clientId =
    sessionClientId ||
    ((userType === 'client' && userId && tenantId)
      ? await getUserClientId(userId, tenantId)
      : undefined);

  const userInfo: ExtProxyUserInfo = {
    user_id: userId,
    user_email: user.email || '',
    user_name: user.name || user.username || '',
    user_type: userType,
    client_name: clientName,
    client_id: clientId,
    additional_fields: extractAdditionalFields(user as Record<string, unknown>),
  };

  return userInfo;
}

export type TenantAuthErrorCode =
  | 'unauthenticated'
  | 'invalid_session'
  | 'invalid_service_auth'
  | 'missing_tenant'
  | 'mixed_auth'
  | 'tenant_mismatch';

/**
 * Typed tenant-resolution failure. Route boundaries map this to a generic 401
 * (missing/invalid authentication) or 403 (conflicting tenant evidence). The
 * internal `code` is stable and may be logged; request credentials (runner
 * token, cookies, tenant header values) must never be included in logs.
 *
 * Mirrors server/src/lib/extensions/gateway/auth.ts. It is duplicated here so
 * this package does not import the `server` app (which depends on this
 * package), which would create a build/project-graph cycle.
 */
// LEVERAGE: friction ext-proxy-tenant-auth — session tenant resolver + error
// type are duplicated between server/src/lib/extensions/gateway/auth.ts and
// this package because the only shared home would be a `server` import that
// cycles the project graph; a shared low-layer package would remove the copy.
export class TenantAuthError extends Error {
  readonly code: TenantAuthErrorCode;
  readonly status: number;

  constructor(code: TenantAuthErrorCode, message: string) {
    super(message);
    this.name = 'TenantAuthError';
    this.code = code;
    this.status = code === 'tenant_mismatch' ? 403 : 401;
  }
}

/**
 * Resolve the tenant for a browser/session flow.
 *
 * The session is the only tenant authority. `x-alga-tenant` and `x-tenant-id`
 * are normalized and checked only for consistency during compatibility; they
 * can never select a tenant, and a header that disagrees with the session
 * fails closed with `tenant_mismatch`. A partial session (session object with
 * a missing/blank tenant) throws `invalid_session` before any header is
 * considered, and never falls through to service authentication.
 */
export async function getTenantFromSessionAuth(req: NextRequest): Promise<string> {
  const session = await getSession();

  if (!session) {
    throw new TenantAuthError('unauthenticated', 'No authenticated session found');
  }

  const rawTenant = (session.user as { tenant?: unknown } | null | undefined)?.tenant;
  if (typeof rawTenant !== 'string' || !rawTenant.trim()) {
    throw new TenantAuthError('invalid_session', 'Session is missing a tenant');
  }
  const tenant = rawTenant.trim();

  const canonical = toNonEmptyString(req.headers.get('x-alga-tenant'));
  const legacy = toNonEmptyString(req.headers.get('x-tenant-id'));

  if (canonical && canonical !== tenant) {
    throw new TenantAuthError('tenant_mismatch', 'x-alga-tenant header does not match the session tenant');
  }
  if (legacy && legacy !== tenant) {
    throw new TenantAuthError('tenant_mismatch', 'x-tenant-id header does not match the session tenant');
  }
  if (canonical && legacy && canonical !== legacy) {
    throw new TenantAuthError('tenant_mismatch', 'Conflicting tenant headers supplied');
  }

  return tenant;
}
