import { getCurrentUser } from '@alga-psa/user-composition/actions';
import { tenantDb } from '@alga-psa/db';
import type { TenantDb } from '@alga-psa/db';
import { getAdminConnection } from '@alga-psa/db/admin';
import { hasPermission } from 'server/src/lib/auth/rbac';
import {
  matchEndpoint,
  type ApiEndpointDef,
  type Method,
} from '@product/ext-proxy/shared/gateway-utils';
import { TokenBucketRateLimiter } from '@alga-psa/core/rateLimit';

const EXTENSION_GATEWAY_RATE_LIMIT_NAMESPACE = 'extension-gateway';

const SUPPORTED_METHODS: readonly string[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];

export type ExtensionGatewayAccessErrorCode =
  | 'unauthenticated'
  | 'tenant_mismatch'
  | 'extension_not_available'
  | 'forbidden'
  | 'endpoint_not_found'
  | 'rate_limited'
  | 'access_policy_unavailable';

/**
 * Typed policy failure. Only this error type may be mapped to controlled
 * responses by the gateway handlers; anything else must become a generic 503.
 */
export class ExtensionGatewayAccessError extends Error {
  readonly code: ExtensionGatewayAccessErrorCode;
  readonly status: number;
  readonly retryAfterSeconds?: number;

  constructor(
    code: ExtensionGatewayAccessErrorCode,
    status: number,
    message: string,
    retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = 'ExtensionGatewayAccessError';
    this.code = code;
    this.status = status;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export type ExtensionGatewayPrincipal =
  | { kind: 'msp'; userId: string }
  | { kind: 'client'; userId: string; clientId: string };

export interface AuthorizedExtensionAccess {
  tenantId: string;
  installId: string;
  registryId: string;
  versionId: string;
  endpoint: ApiEndpointDef;
  principal: ExtensionGatewayPrincipal;
}

export interface AssertExtensionAccessInput {
  tenantId: string;
  extensionId: string;
  method: string;
  path: string;
}

interface TenantInstallAccessRow {
  install_id: string;
  registry_id: string;
  version_id: string;
  is_enabled: boolean;
  status: string;
  api_endpoints: unknown;
  ui: unknown;
}

function isUuid(value: string): boolean {
  const trimmed = value.trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    trimmed
  );
}

function isSupportedMethod(method: string): method is Method {
  return SUPPORTED_METHODS.includes(method);
}

function normalizeMethod(value: unknown): Method | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toUpperCase();
  return isSupportedMethod(normalized) ? normalized : null;
}

function parseApiEndpoints(raw: unknown): ApiEndpointDef[] {
  let list: unknown = raw;
  if (typeof raw === 'string') {
    try {
      list = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(list)) return [];

  const endpoints: ApiEndpointDef[] = [];
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const entry = item as Record<string, unknown>;
    const method = normalizeMethod(entry.method);
    if (!method) continue;
    const path = typeof entry.path === 'string' ? entry.path.trim() : '';
    const handler = typeof entry.handler === 'string' ? entry.handler : '';
    if (!path || !handler) continue;
    endpoints.push({ method, path, handler });
  }
  return endpoints;
}

function getClientPortalMenuLabel(ui: unknown): string | null {
  if (!ui || typeof ui !== 'object') return null;
  const hooks = (ui as Record<string, unknown>).hooks;
  if (!hooks || typeof hooks !== 'object') return null;
  const clientPortalMenu = (hooks as Record<string, unknown>).clientPortalMenu;
  if (!clientPortalMenu || typeof clientPortalMenu !== 'object') return null;
  const label = (clientPortalMenu as Record<string, unknown>).label;
  return typeof label === 'string' && label.trim() ? label : null;
}

/**
 * Resolve the tenant-scoped contact association for a client user. Mirrors the
 * proxy user-context code (users.contact_id -> contacts.contact_name_id).
 */
async function resolveClientIdForUser(db: TenantDb, userId: string): Promise<string | null> {
  const query = db.table('users as u').select('c.client_id').where('u.user_id', userId);
  const result = await db
    .tenantJoin(query, 'contacts as c', 'c.contact_name_id', 'u.contact_id')
    .first();
  const clientId = result?.client_id;
  return typeof clientId === 'string' && clientId.trim() ? clientId : null;
}

async function loadTenantInstall(
  db: TenantDb,
  extensionId: string,
): Promise<TenantInstallAccessRow | null> {
  const slug = extensionId.toLowerCase();
  const isId = isUuid(extensionId);

  const query = db.table('tenant_extension_install as install')
    .leftJoin('extension_registry as registry', 'registry.id', 'install.registry_id')
    .leftJoin('extension_version as version', 'version.id', 'install.version_id')
    .where('install.is_enabled', true)
    .where('install.status', 'enabled')
    .andWhere((builder) => {
      if (isId) {
        builder.where('install.id', extensionId);
        builder.orWhere('install.registry_id', extensionId);
        builder.orWhereRaw('lower(concat(registry.publisher, \'.\', registry.name)) = ?', [slug]);
        return;
      }
      builder.whereRaw('lower(concat(registry.publisher, \'.\', registry.name)) = ?', [slug]);
    })
    .select<TenantInstallAccessRow[]>([
      'install.id as install_id',
      'install.registry_id',
      'install.version_id',
      'install.is_enabled',
      'install.status',
      'version.api_endpoints',
      'version.ui',
    ])
    .first();

  const row = await query;
  return row ?? null;
}

/**
 * Canonical fail-closed access policy for extension execution. Both the direct
 * `/api/ext` gateway and the ext-proxy handler must consume this function and
 * no other authorization decision.
 *
 * Denies unless, in order: an authenticated session principal whose tenant
 * matches, an active tenant-owned install, a declared endpoint on the
 * installed version, MSP `extension` RBAC or client-portal opt-in with a
 * resolvable client, a rate-limit budget, and a pre-dispatch audit decision.
 */
export async function assertAccess(input: AssertExtensionAccessInput): Promise<AuthorizedExtensionAccess> {
  const { tenantId, extensionId, path } = input;
  const method = normalizeMethod(input.method);
  if (!method) {
    throw new ExtensionGatewayAccessError('endpoint_not_found', 404, 'Endpoint not found');
  }

  const user = await getCurrentUser();
  if (!user || !user.user_id || !user.tenant || !user.user_type) {
    throw new ExtensionGatewayAccessError('unauthenticated', 401, 'Authentication required');
  }
  if (String(user.tenant) !== tenantId) {
    throw new ExtensionGatewayAccessError('tenant_mismatch', 403, 'Tenant mismatch');
  }

  const knex = await getAdminConnection();
  const db = tenantDb(knex, tenantId);

  const install = await loadTenantInstall(db, extensionId);
  if (!install) {
    throw new ExtensionGatewayAccessError('extension_not_available', 404, 'Extension is not available');
  }

  const endpoints = parseApiEndpoints(install.api_endpoints);
  const matched = matchEndpoint(endpoints, method, path);
  if (!matched) {
    throw new ExtensionGatewayAccessError('endpoint_not_found', 404, 'Endpoint not found');
  }
  const endpoint =
    endpoints.find((candidate) => matchEndpoint([candidate], method, path) !== null) ??
    { method, path, handler: matched.handler };

  let principal: ExtensionGatewayPrincipal;
  if (user.user_type === 'client') {
    if (!getClientPortalMenuLabel(install.ui)) {
      throw new ExtensionGatewayAccessError('forbidden', 403, 'Not allowed');
    }
    const clientId = await resolveClientIdForUser(db, user.user_id);
    if (!clientId) {
      throw new ExtensionGatewayAccessError('forbidden', 403, 'Not allowed');
    }
    principal = { kind: 'client', userId: user.user_id, clientId };
  } else {
    const action = method === 'GET' ? 'read' : 'write';
    const allowed = await hasPermission(user, 'extension', action, knex);
    if (!allowed) {
      throw new ExtensionGatewayAccessError('forbidden', 403, 'Not allowed');
    }
    principal = { kind: 'msp', userId: user.user_id };
  }

  const rateLimit = await TokenBucketRateLimiter.getInstance().tryConsume(
    EXTENSION_GATEWAY_RATE_LIMIT_NAMESPACE,
    tenantId,
    install.registry_id,
  );
  if (!rateLimit.allowed) {
    const retryAfterSeconds =
      typeof rateLimit.retryAfterMs === 'number' && rateLimit.retryAfterMs > 0
        ? Math.max(1, Math.ceil(rateLimit.retryAfterMs / 1000))
        : 1;
    throw new ExtensionGatewayAccessError(
      'rate_limited',
      429,
      'Rate limit exceeded',
      retryAfterSeconds,
    );
  }
  if (rateLimit.remaining < 0) {
    // Redis did not enforce the budget (fail-open sentinel). Treat as an
    // unavailable policy dependency, never as success.
    throw new ExtensionGatewayAccessError(
      'access_policy_unavailable',
      503,
      'Rate limiting is unavailable',
    );
  }

  return {
    tenantId,
    installId: install.install_id,
    registryId: install.registry_id,
    versionId: install.version_id,
    endpoint,
    principal,
  };
}
