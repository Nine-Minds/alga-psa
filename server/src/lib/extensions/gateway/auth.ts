import { NextRequest } from 'next/server';
import { getSession } from '@alga-psa/auth';
import { tenantDb } from '@alga-psa/db';
import { getAdminConnection } from '@alga-psa/db/admin';
import { assertRunnerAuth, RunnerAuthError } from '../runnerAuth';

export interface ExtProxyUserInfo {
  user_id: string;
  user_email: string;
  user_name: string;
  user_type: string;
  client_name: string;
  /** For client portal users, the client_id they are associated with */
  client_id?: string;
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
 */
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

function normalizeHeaderValue(value: string | null): string | undefined {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

/**
 * Get full user info from session for passing to runner.
 * Returns null if no valid session exists.
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

  return userInfo;
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

  const canonical = normalizeHeaderValue(req.headers.get('x-alga-tenant'));
  const legacy = normalizeHeaderValue(req.headers.get('x-tenant-id'));

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

/**
 * Resolve the tenant for a service flow.
 *
 * A tenant header is honored only after an explicit service credential
 * (`x-runner-auth` matching `RUNNER_SERVICE_TOKEN`) is verified with a
 * constant-time comparison. `RUNNER_STORAGE_API_TOKEN` is deliberately not
 * accepted here. Any session object — even a partial one — rejects with
 * `mixed_auth` so partial sessions are never reinterpreted as service callers.
 * `x-tenant-id` remains a documented legacy alias under service
 * authentication; when both headers are supplied they must agree exactly.
 */
export async function getTenantFromServiceAuth(req: NextRequest): Promise<string> {
  const session = await getSession();

  if (session) {
    throw new TenantAuthError('mixed_auth', 'Session must not be combined with service authentication');
  }

  try {
    assertRunnerAuth(req.headers.get('x-runner-auth'), process.env.RUNNER_SERVICE_TOKEN);
  } catch (error) {
    if (error instanceof RunnerAuthError) {
      throw new TenantAuthError('invalid_service_auth', 'Invalid or unconfigured service token');
    }
    throw error;
  }

  const canonical = normalizeHeaderValue(req.headers.get('x-alga-tenant'));
  const legacy = normalizeHeaderValue(req.headers.get('x-tenant-id'));

  const tenant = canonical || legacy;
  if (!tenant) {
    throw new TenantAuthError('missing_tenant', 'Service request is missing a tenant header');
  }
  if (canonical && legacy && canonical !== legacy) {
    throw new TenantAuthError('tenant_mismatch', 'Conflicting tenant headers supplied');
  }

  return tenant;
}

export async function assertAccess(_tenantId: string, _extensionId: string, _method: string, _path: string): Promise<void> {
  // TODO: implement RBAC and per-tenant endpoint checks
  return;
}
