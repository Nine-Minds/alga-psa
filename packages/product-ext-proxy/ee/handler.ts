import { NextRequest, NextResponse } from 'next/server';
import { appendFileSync } from 'node:fs';
import path from 'node:path';

import { filterRequestHeaders, getTimeoutMs, pathnameFromParts } from '../shared/gateway-utils';
import { loadInstallConfigCached } from './install-config-cache';
import { getRunnerBackend, RunnerConfigError, RunnerRequestError } from './runner-backend';
import { getTenantFromAuth, getUserInfoFromAuth, assertAccess } from 'server/src/lib/extensions/gateway/auth';

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'OPTIONS';

const debugLogPath = path.resolve(process.env.EXT_PROXY_DEBUG_LOG || '/tmp/ext-proxy.log');

function logDebug(event: string, payload: Record<string, unknown>) {
  try {
    appendFileSync(
      debugLogPath,
      `${new Date().toISOString()} ${event} ${JSON.stringify(payload)}\n`,
      'utf8',
    );
  } catch {
    // swallow logging errors
  }
}

class AccessError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

// Re-export AccessError for use in assertAccess wrapper
function wrapAssertAccess(tenantId: string, extensionId: string, method: string, pathname: string): Promise<void> {
  // Use the same permissive access check as /api/ext/ route
  // TODO: implement proper RBAC for extension proxy calls
  return assertAccess(tenantId, extensionId, method, pathname);
}

export const dynamic = 'force-dynamic';

function json(status: number, body: any, headers: HeadersInit = {}) {
  return new NextResponse(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json',
      ...headers,
    },
  });
}

function appendVary(existing: string | null, value: string): string {
  if (!existing) return value;
  const parts = existing.split(',').map((part) => part.trim().toLowerCase());
  if (parts.includes(value.toLowerCase())) return existing;
  return `${existing}, ${value}`;
}

function parseOrigin(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    return new URL(value).origin.toLowerCase();
  } catch {
    return null;
  }
}

function getAllowedOrigins(): string[] {
  const candidates = [
    process.env.RUNNER_PUBLIC_BASE,
    process.env.NEXTAUTH_URL,
    process.env.HOST,
  ];
  const extras = process.env.EXT_PROXY_ALLOWED_ORIGINS;
  if (extras) {
    for (const value of extras.split(',').map((entry) => entry.trim()).filter(Boolean)) {
      candidates.push(value);
    }
  }
  const unique = new Set<string>();
  for (const candidate of candidates) {
    const origin = parseOrigin(candidate);
    if (origin) {
      unique.add(origin);
    }
  }
  return Array.from(unique);
}

function pickCorsOrigin(req: NextRequest): string | null {
  const origin = req.headers.get('origin');
  if (!origin) return null;
  const normalized = origin.toLowerCase();
  const allowed = getAllowedOrigins();
  if (allowed.length === 0) return null;
  return allowed.includes(normalized) ? origin : null;
}

function applyCorsHeaders(response: NextResponse, origin: string | null): NextResponse {
  if (!origin) return response;
  response.headers.set('access-control-allow-origin', origin);
  response.headers.set('access-control-allow-credentials', 'true');
  const currentVary = response.headers.get('vary');
  response.headers.set('vary', appendVary(currentVary, 'Origin'));
  return response;
}

function corsPreflight(origin: string | null): NextResponse {
  const headers = new Headers();
  if (origin) {
    headers.set('access-control-allow-origin', origin);
    headers.set('access-control-allow-credentials', 'true');
  }
  headers.set('access-control-allow-methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  headers.set('access-control-allow-headers', 'content-type,x-request-id,x-alga-tenant');
  headers.set('access-control-max-age', '120');
  headers.set('vary', 'Origin, Access-Control-Request-Headers');
  return new NextResponse(null, { status: 204, headers });
}

function getRequestId(req: NextRequest): string {
  return req.headers.get('x-request-id') || crypto.randomUUID();
}

type RouteParams = { extensionId: string; path?: string[] };

async function handle(
  req: NextRequest,
  ctx: { params: RouteParams | Promise<RouteParams> },
) {
  const method = req.method as Method;
  const requestId = getRequestId(req);
  const corsOrigin = pickCorsOrigin(req);

  if (method === 'OPTIONS') {
    return corsPreflight(corsOrigin);
  }

  try {
    const routeParams = await ctx.params;
    const extensionId = routeParams.extensionId;
    const pathParts = Array.isArray(routeParams.path) ? routeParams.path : [];
    const pathname = pathnameFromParts(pathParts);
    const url = new URL(req.url);

    const tenantId = await getTenantFromAuth(req);
    const userInfo = await getUserInfoFromAuth(req);
    logDebug('ext-proxy:start', { tenantId, extensionId, method, hasUserInfo: !!userInfo });
    if (!tenantId) return applyCorsHeaders(json(401, { error: 'Unauthorized' }), corsOrigin);

    await wrapAssertAccess(tenantId, extensionId, method, pathname);

    const installConfig = await loadInstallConfigCached(tenantId, extensionId);
    if (!installConfig) {
      return applyCorsHeaders(json(404, { error: 'Extension not installed' }), corsOrigin);
    }
    if (!installConfig.contentHash) {
      console.error('[ext-proxy] Missing content hash', { tenantId, extensionId });
      return applyCorsHeaders(json(502, { error: 'Extension bundle unavailable' }), corsOrigin);
    }

    const timeoutMs = getTimeoutMs();
    const bodyBuf = method === 'GET' ? undefined : Buffer.from(await req.arrayBuffer());

    console.log('[ext-proxy] Preparing execution request', {
      requestId,
      tenantId,
      extensionId,
      path: pathname,
      installId: installConfig.installId,
      versionId: installConfig.versionId,
      contentHash: installConfig.contentHash,
      timeoutMs,
      hasBody: !!bodyBuf,
    });

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
        url: pathname,
        path: pathname,
        query: Object.fromEntries(url.searchParams.entries()),
        headers: filterRequestHeaders(req.headers, tenantId, extensionId, requestId, method),
        body_b64: bodyBuf ? bodyBuf.toString('base64') : undefined,
      },
      limits: { timeout_ms: timeoutMs },
      providers: installConfig.providers,
      secret_envelope: installConfig.secretEnvelope ?? undefined,
      endpoint: `ui-proxy:${pathname}`,
      // Pass user info from session to runner for activity logging
      user: userInfo ? {
        user_id: userInfo.user_id,
        user_email: userInfo.user_email,
        user_name: userInfo.user_name,
        user_type: userInfo.user_type,
        client_name: userInfo.client_name,
      } : undefined,
    };

    const backend = getRunnerBackend();
    console.log('[ext-proxy] Using runner backend', {
      kind: backend.kind,
      publicBase: backend.getPublicBase()
    });

    const runnerHeaders: Record<string, string> = {
      'x-alga-tenant': tenantId,
      'x-alga-extension': extensionId,
    };
    if (installConfig.configVersion) {
      runnerHeaders['x-ext-config-version'] = installConfig.configVersion;
    }
    if (installConfig.secretsVersion) {
      runnerHeaders['x-ext-secrets-version'] = installConfig.secretsVersion;
    }

    console.log('[ext-proxy] Executing request via runner backend...');
    const runnerResp = await backend.execute(execReq, {
      requestId,
      timeoutMs,
      headers: runnerHeaders,
    });
    console.log('[ext-proxy] Execution completed', {
      status: runnerResp.status,
      bodyLength: runnerResp.body?.length
    });

    const proxyResponse = new NextResponse(runnerResp.body as any, {
      status: runnerResp.status,
      headers: runnerResp.headers,
    });
    return applyCorsHeaders(proxyResponse, corsOrigin);
  } catch (error: any) {
    console.error('[ext-proxy] Handler exception', {
      name: error?.name,
      message: error?.message,
      stack: error?.stack,
      request_id: getRequestId(req)
    });
    logDebug('ext-proxy:error', { message: error?.message, name: error?.name, stack: error?.stack });
    if (error instanceof AccessError) {
      return applyCorsHeaders(json(error.status, { error: error.message }), corsOrigin);
    }
    if (error instanceof RunnerConfigError) {
      console.error('[ext-proxy] Runner configuration error:', error.message);
      return applyCorsHeaders(json(500, { error: 'Runner not configured' }), corsOrigin);
    }
    if (error instanceof RunnerRequestError) {
      console.error('[ext-proxy] Runner request error:', error.message, { backend: error.backend, status: error.status });
      const status = error.status || 502;
      return applyCorsHeaders(json(status, { error: 'Runner error', details: error.message }), corsOrigin);
    }
    if (error?.name === 'AbortError') {
      return applyCorsHeaders(json(504, { error: 'Gateway timeout' }), corsOrigin);
    }
    console.error('[ext-proxy] Unhandled error:', error?.message, error?.stack);
    return applyCorsHeaders(json(500, { error: 'Internal error', detail: String(error?.message || error) }), corsOrigin);
  }
}

export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
