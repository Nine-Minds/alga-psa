import { NextRequest, NextResponse } from 'next/server';
import { appendFileSync } from 'node:fs';
import path from 'node:path';

import { filterRequestHeaders, getTimeoutMs, pathnameFromParts } from '../shared/gateway-utils';
import { loadInstallConfigCached } from './install-config-cache';
import { getRunnerBackend, RunnerConfigError, RunnerRequestError } from './runner-backend';
import { getTenantFromAuth, assertAccess } from 'server/src/lib/extensions/gateway/auth';
import { getSession } from 'server/src/lib/auth/getSession';

/**
 * Route mapping for platform API prefetching.
 * Maps extension routes to platform API endpoints.
 */
interface PrefetchRoute {
  pattern: RegExp;
  buildApiPath: (match: RegExpMatchArray, query: URLSearchParams) => string;
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
}

const PREFETCH_ROUTES: PrefetchRoute[] = [
  // /reports -> GET/POST /api/v1/platform-reports (method determined by body content)
  { pattern: /^\/reports$/, buildApiPath: () => '/api/v1/platform-reports' },
  // /reports/:id -> GET/PUT/DELETE /api/v1/platform-reports/:id (method determined by body __action)
  { pattern: /^\/reports\/([0-9a-f-]+)$/, buildApiPath: (m) => `/api/v1/platform-reports/${m[1]}` },
  // /reports/:id/execute -> POST /api/v1/platform-reports/:id/execute
  { pattern: /^\/reports\/([0-9a-f-]+)\/execute$/, buildApiPath: (m) => `/api/v1/platform-reports/${m[1]}/execute`, method: 'POST' },
  // /schema -> GET /api/v1/platform-reports/schema
  { pattern: /^\/schema$/, buildApiPath: () => '/api/v1/platform-reports/schema', method: 'GET' },
  // /access -> POST /api/v1/platform-reports/access
  { pattern: /^\/access$/, buildApiPath: () => '/api/v1/platform-reports/access', method: 'POST' },
  // /audit -> GET /api/v1/platform-reports/audit
  { pattern: /^\/audit/, buildApiPath: (_m, q) => `/api/v1/platform-reports/audit${q.toString() ? '?' + q.toString() : ''}`, method: 'GET' },
  // Tenant management routes - explicitly set GET to prevent iframe POST from overriding
  { pattern: /^\/api\/v1\/tenant-management\/tenants$/, buildApiPath: () => '/api/v1/tenant-management/tenants', method: 'GET' },
  { pattern: /^\/api\/v1\/tenant-management\/audit/, buildApiPath: (_m, q) => `/api/v1/tenant-management/audit${q.toString() ? '?' + q.toString() : ''}`, method: 'GET' },
  { pattern: /^\/api\/v1\/tenant-management\/create-tenant$/, buildApiPath: () => '/api/v1/tenant-management/create-tenant', method: 'POST' },
  { pattern: /^\/api\/v1\/tenant-management\/resend-welcome-email$/, buildApiPath: () => '/api/v1/tenant-management/resend-welcome-email', method: 'POST' },
];

/**
 * Find a prefetch route for the given pathname.
 */
function findPrefetchRoute(pathname: string): { route: PrefetchRoute; match: RegExpMatchArray } | null {
  for (const route of PREFETCH_ROUTES) {
    const match = pathname.match(route.pattern);
    if (match) {
      return { route, match };
    }
  }
  return null;
}

/**
 * Prefetch data from platform API server-side.
 * This runs on the Next.js server where we have access to the user session.
 *
 * We get the session directly and pass user info in trusted internal headers,
 * bypassing the need for cookie-based auth on the internal request.
 */
async function prefetchPlatformApi(
  req: NextRequest,
  apiPath: string,
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'GET',
  body?: Buffer,
): Promise<{ status: number; data: unknown } | null> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000); // 15 second timeout for prefetch

  try {
    // Get the session directly - we're in the same Next.js server context
    const session = await getSession();
    const sessionUser = session?.user as any;

    if (!sessionUser?.id || !sessionUser?.tenant) {
      console.warn('[ext-proxy] No valid session for prefetch, skipping');
      return null;
    }

    // Build the full URL for the platform API
    const baseUrl = process.env.NEXTAUTH_URL || process.env.HOST || 'http://localhost:3000';
    const url = `${baseUrl}${apiPath}`;

    console.log('[ext-proxy] Prefetching platform API:', { method, url, userId: sessionUser.id, tenant: sessionUser.tenant });

    // Pass trusted user info in internal headers
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      // Add a dummy API key to pass middleware check
      'x-api-key': 'internal-ext-proxy-prefetch',
      // Mark this as an internal request with trusted user info
      'x-internal-request': 'ext-proxy-prefetch',
      'x-internal-user-id': sessionUser.id,
      'x-internal-user-tenant': sessionUser.tenant,
      'x-internal-user-email': sessionUser.email || '',
    };

    const fetchOptions: RequestInit = {
      method,
      headers,
      signal: controller.signal,
    };

    if (body && method !== 'GET') {
      fetchOptions.body = body.toString('utf-8');
    }

    const response = await fetch(url, fetchOptions);
    clearTimeout(timeoutId);

    const text = await response.text();

    let data: unknown;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }

    console.log('[ext-proxy] Prefetch response:', { status: response.status, hasData: !!data });

    return { status: response.status, data };
  } catch (error) {
    clearTimeout(timeoutId);
    if ((error as any)?.name === 'AbortError') {
      console.warn('[ext-proxy] Prefetch timed out after 15s, continuing without prefetched data');
    } else {
      console.error('[ext-proxy] Prefetch failed:', error);
    }
    return null;
  }
}

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
    logDebug('ext-proxy:start', { tenantId, extensionId, method });
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

    // Check if this route needs platform API prefetching
    const prefetchResult = findPrefetchRoute(pathname);
    let prefetchedData: { status: number; data: unknown } | null = null;

    if (prefetchResult) {
      const { route, match } = prefetchResult;
      const apiPath = route.buildApiPath(match, url.searchParams);

      // Determine the HTTP method for the prefetch
      // Priority: route.method > __action in body > request method
      let apiMethod: 'GET' | 'POST' | 'PUT' | 'DELETE' = route.method || 'GET';

      if (!route.method && bodyBuf) {
        try {
          const bodyJson = JSON.parse(bodyBuf.toString('utf-8'));
          if (bodyJson.__action === 'delete') {
            apiMethod = 'DELETE';
          } else if (bodyJson.__action === 'update') {
            apiMethod = 'PUT';
          } else if (bodyJson.__action === 'create' || bodyJson.name || bodyJson.report_definition) {
            apiMethod = 'POST';
          }
          // If no explicit action, keep default GET - the iframe always sends POST
          // but that doesn't mean the underlying API should use POST
        } catch {
          // If body parse fails, keep default GET
        }
      }

      console.log('[ext-proxy] Route requires prefetch:', { pathname, apiPath, apiMethod });

      prefetchedData = await prefetchPlatformApi(req, apiPath, apiMethod, bodyBuf);

      // SHORT-CIRCUIT: If we have prefetched data, return it directly instead of going through the runner.
      // The WASM handler just passes through the prefetched data anyway, and the Rust runner
      // doesn't currently forward the prefetched_data field to the WASM component.
      // This is more efficient and avoids the runner timeout issue.
      if (prefetchedData) {
        console.log('[ext-proxy] Returning prefetched data directly (short-circuit)', {
          requestId,
          status: prefetchedData.status,
          hasData: !!prefetchedData.data,
        });

        const responseBody = JSON.stringify(prefetchedData.data);
        const proxyResponse = new NextResponse(responseBody, {
          status: prefetchedData.status,
          headers: {
            'content-type': 'application/json',
            'x-ext-request-id': requestId,
          },
        });
        return applyCorsHeaders(proxyResponse, corsOrigin);
      }

      // If prefetch failed, log a warning but continue to runner
      // (for routes that might have fallback behavior in the WASM handler)
      console.warn('[ext-proxy] Prefetch returned null, continuing to runner', { pathname });
    }

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
      hasPrefetchedData: !!prefetchedData,
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
      // Include prefetched data for the WASM handler to use
      prefetched_data: prefetchedData,
      http: {
        method,
        path: pathname,
        query: Object.fromEntries(url.searchParams.entries()),
        headers: filterRequestHeaders(req.headers, tenantId, extensionId, requestId, method),
        body_b64: bodyBuf ? bodyBuf.toString('base64') : undefined,
      },
      limits: { timeout_ms: timeoutMs },
      providers: installConfig.providers,
      secret_envelope: installConfig.secretEnvelope ?? undefined,
      endpoint: `ui-proxy:${pathname}`,
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
