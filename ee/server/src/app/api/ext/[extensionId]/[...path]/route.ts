import { NextRequest, NextResponse } from 'next/server';

import { matchEndpoint, pathnameFromParts, filterRequestHeaders, getTimeoutMs } from '../../../../../lib/extensions/lib/gateway-utils';
import { getRegistryFacade } from '../../../../../lib/extensions/lib/gateway-registry';
import { loadInstallConfigCached } from '../../../../../lib/extensions/lib/install-config-cache';
import { getCurrentUser } from 'server/src/lib/actions/user-actions/userActions';
import { hasPermission } from 'server/src/lib/auth/rbac';
import { getTenantFromAuth } from 'server/src/lib/extensions/gateway/auth';
import { getRunnerBackend, RunnerConfigError, RunnerRequestError } from '../../../../../lib/extensions/runner/backend';
import { createTenantKnex } from 'server/src/lib/db';
export const dynamic = 'force-dynamic';

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

interface GatewayContext {
  extensionId: string;
  pathParts: string[];
}

function getRequestId(req: NextRequest): string {
  return req.headers.get('x-request-id') || crypto.randomUUID();
}

function json(status: number, body: any, headers: HeadersInit = {}) {
  return new NextResponse(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json',
      ...headers,
    },
  });
}

const ALLOWED_METHODS = 'GET,POST,PUT,PATCH,DELETE,OPTIONS';
const ALLOWED_HEADERS = 'content-type,x-request-id,x-idempotency-key,x-alga-tenant';

function normalizeOrigin(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return `${url.protocol}//${url.host}`.toLowerCase();
  } catch {
    return null;
  }
}

function extraAllowedOrigins(): string[] {
  const raw = process.env.EXT_GATEWAY_ALLOWED_ORIGINS;
  if (!raw) return [];
  return raw
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function pickCorsOrigin(req: NextRequest): string | null {
  const originHeader = req.headers.get('origin');
  if (!originHeader) return null;
  const normalized = normalizeOrigin(originHeader);
  if (!normalized) return null;

  const allowlist = new Set([
    'https://algapsa.com',
    'https://www.algapsa.com',
    ...extraAllowedOrigins().map((entry) => normalizeOrigin(entry)).filter(Boolean),
  ]);
  if (allowlist.has(normalized)) {
    return originHeader;
  }
  if (normalized.endsWith('.apps.algapsa.com')) {
    return originHeader;
  }
  if (process.env.NODE_ENV !== 'production') {
    if (normalized === 'http://localhost:3000' || normalized === 'http://127.0.0.1:3000') {
      return originHeader;
    }
  }
  return null;
}

function applyCorsHeaders(response: NextResponse, origin: string | null): NextResponse {
  if (!origin) return response;
  response.headers.set('access-control-allow-origin', origin);
  response.headers.set('access-control-allow-credentials', 'true');
  const vary = response.headers.get('vary');
  response.headers.set('vary', vary ? `${vary}, Origin` : 'Origin');
  return response;
}

function corsPreflight(origin: string | null): NextResponse {
  const headers = new Headers();
  if (origin) {
    headers.set('access-control-allow-origin', origin);
    headers.set('access-control-allow-credentials', 'true');
  }
  headers.set('access-control-allow-methods', ALLOWED_METHODS);
  headers.set('access-control-allow-headers', ALLOWED_HEADERS);
  headers.set('access-control-max-age', '180');
  headers.set('vary', 'Origin, Access-Control-Request-Headers');
  return new NextResponse(null, { status: 204, headers });
}


// TODO: wire to real auth/session
// In non-production, return a deterministic tenant for local testing.
// In production, return null (401 will be returned by caller).
// Reference: ee/docs/extension-system/api-routing-guide.md
class AccessError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function actionForMethod(method: Method): 'read' | 'write' {
  return method === 'GET' ? 'read' : 'write';
}

interface UserAccessResult {
  user_id: string;
  user_email: string;
  user_name: string;
}

async function assertAccess(tenantId: string, method: Method): Promise<UserAccessResult | null> {
  const currentUser = await getCurrentUser();
  if (!currentUser || !currentUser.tenant) {
    throw new AccessError(401, 'Unauthorized');
  }
  if (currentUser.tenant !== tenantId) {
    throw new AccessError(401, 'Unauthorized');
  }

  const requiredAction = actionForMethod(method);
  const allowed = await hasPermission(currentUser, 'extension', requiredAction);
  if (!allowed) {
    throw new AccessError(403, 'Forbidden');
  }

  // Return user info for the extension context
  return {
    user_id: currentUser.user_id,
    user_email: currentUser.email || '',
    user_name: `${currentUser.first_name || ''} ${currentUser.last_name || ''}`.trim(),
  };
}

async function getTenantCompanyName(tenantId: string): Promise<string> {
  try {
    const { knex } = await createTenantKnex();
    const tenant = await knex('tenants')
      .select('client_name')
      .where('tenant', tenantId)
      .first();
    return tenant?.client_name || '';
  } catch (err) {
    console.error('[ext-gateway] Failed to fetch tenant company name:', err);
    return '';
  }
}

// Load manifest v2 for version_id and match endpoint (method + path)
async function resolveEndpoint(
  versionId: string,
  method: Method,
  pathname: string
): Promise<{ handler: string } | null> {
  const facade = getRegistryFacade();
  const manifest = await facade.getManifest(versionId);
  if (!manifest?.api?.endpoints) return null;
  return matchEndpoint(manifest.api.endpoints as any, method, pathname);
}


async function handle(req: NextRequest, { params }: { params: { extensionId: string; path: string[] } }) {
  const method = req.method as Method;
  const requestId = getRequestId(req);
  const corsOrigin = pickCorsOrigin(req);
  if (req.method.toUpperCase() === 'OPTIONS') {
    return corsPreflight(corsOrigin);
  }

  try {
    const extensionId = params.extensionId;
    const pathParts = Array.isArray(params.path) ? params.path : [];
    const pathname = pathnameFromParts(pathParts);
    const url = new URL(req.url);

    const tenantId = await getTenantFromAuth(req);
    if (!tenantId) return json(401, { error: 'Unauthorized' });

    const userInfo = await assertAccess(tenantId, method);

    const installConfig = await loadInstallConfigCached(tenantId, extensionId);
    if (!installConfig) return json(404, { error: 'Extension not installed' });
    if (!installConfig.contentHash) {
      console.error('[ext-gateway] Missing content hash for install', { tenantId, extensionId });
      return json(502, { error: 'Extension bundle unavailable' });
    }

    const endpoint = await resolveEndpoint(installConfig.versionId, method, pathname);
    if (!endpoint) return json(404, { error: 'Endpoint not found' });

    const timeoutMs = getTimeoutMs();

    // Fetch tenant company name for user context (only if user info is available)
    let companyName = '';
    if (userInfo) {
      companyName = await getTenantCompanyName(tenantId);
    }

    // Body handling
    const bodyBuf = method === 'GET' ? undefined : Buffer.from(await req.arrayBuffer());
    const execReq = {
      context: {
        request_id: requestId,
        tenant_id: tenantId,
        extension_id: extensionId,
        install_id: installConfig.installId,
        version_id: installConfig.versionId,
        content_hash: installConfig.contentHash,
        config: installConfig.config,
      },
      http: {
        method,
        path: pathname,
        query: Object.fromEntries(url.searchParams.entries()),
        headers: filterRequestHeaders(req.headers, tenantId, extensionId, requestId, method),
        body_b64: bodyBuf ? bodyBuf.toString('base64') : undefined,
      },
      limits: { timeout_ms: timeoutMs },
      endpoint: endpoint.handler, // handler id/path inside the bundle
      providers: installConfig.providers,
      secret_envelope: installConfig.secretEnvelope ?? undefined,
      user: userInfo ? {
        user_id: userInfo.user_id,
        user_email: userInfo.user_email,
        user_name: userInfo.user_name,
        company_name: companyName,
      } : undefined,
    };

    const backend = getRunnerBackend();

    const runnerHeaders: Record<string, string> = {};
    if (installConfig.configVersion) {
      runnerHeaders['x-ext-config-version'] = installConfig.configVersion;
    }
    if (installConfig.secretsVersion) {
      runnerHeaders['x-ext-secrets-version'] = installConfig.secretsVersion;
    }
    const runnerResp = await backend.execute(execReq, {
      requestId,
      timeoutMs,
      headers: runnerHeaders,
    });

    return applyCorsHeaders(
      new NextResponse(runnerResp.body as any, {
        status: runnerResp.status,
        headers: runnerResp.headers,
      }),
      corsOrigin,
    );
  } catch (err: any) {
    if (err instanceof AccessError) {
      return applyCorsHeaders(json(err.status, { error: err.message }), corsOrigin);
    }
    if (err instanceof RunnerConfigError) {
      console.error('[ext-gateway] Runner configuration error:', err.message);
      return applyCorsHeaders(json(500, { error: 'Runner not configured' }), corsOrigin);
    }
    if (err instanceof RunnerRequestError) {
      console.error('[ext-gateway] Runner request error:', err.message, { backend: err.backend, status: err.status });
      return applyCorsHeaders(json(502, { error: 'Runner error' }), corsOrigin);
    }
    if (err?.name === 'AbortError') {
      return applyCorsHeaders(json(504, { error: 'Gateway timeout' }), corsOrigin);
    }
    console.error('[ext-gateway] Unhandled error:', err);
    return applyCorsHeaders(json(500, { error: 'Internal error' }), corsOrigin);
  }
}

export { handle, handle as GET, handle as POST, handle as PUT, handle as PATCH, handle as DELETE, handle as OPTIONS };
