import { NextRequest, NextResponse } from 'next/server';

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

// Allowlist for request headers forwarded to runner
const REQUEST_HEADER_ALLOWLIST = new Set([
  'accept',
  'content-type',
  'accept-encoding',
  'user-agent',
  // injected by gateway:
  'x-request-id',
  'x-alga-tenant',
  'x-alga-extension',
  'x-idempotency-key',
]);

// Allowlist for response headers returned to client
const RESPONSE_HEADER_ALLOWLIST = new Set([
  'content-type',
  'cache-control',
  // custom extension headers
  'x-ext-request-id',
  'x-ext-warning',
]);

function filterRequestHeaders(req: NextRequest, tenantId: string, extensionId: string, requestId: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of req.headers.entries()) {
    const key = k.toLowerCase();
    if (key === 'authorization') continue; // strip end-user auth
    if (REQUEST_HEADER_ALLOWLIST.has(key)) {
      out[key] = v;
    }
  }
  // Gateway-injected headers
  out['x-request-id'] = requestId;
  out['x-alga-tenant'] = tenantId;
  out['x-alga-extension'] = extensionId;

  // Idempotency for non-GET
  if (req.method !== 'GET') {
    out['x-idempotency-key'] = out['x-idempotency-key'] || crypto.randomUUID();
  }

  return out;
}

function filterResponseHeaders(headers: Record<string, string | string[] | undefined> | undefined): HeadersInit {
  const res: Record<string, string> = {};
  if (!headers) return res;
  for (const [k, v] of Object.entries(headers)) {
    const key = k.toLowerCase();
    if (!RESPONSE_HEADER_ALLOWLIST.has(key)) continue;
    if (Array.isArray(v)) {
      res[key] = v.join(', ');
    } else if (typeof v === 'string') {
      res[key] = v;
    }
  }
  return res;
}

// TODO: wire to real auth/session
async function getTenantIdFromAuth(_req: NextRequest): Promise<string | null> {
  // Placeholder: replace with real tenant resolution
  return 'tenant-dev';
}

// TODO: implement RBAC check
async function assertAccess(_tenantId: string, _extensionId: string, _method: Method, _pathname: string): Promise<void> {
  return;
}

// TODO: wire to Registry v2 install resolution (tenant -> install -> version -> content_hash)
async function resolveInstall(_tenantId: string, extensionId: string): Promise<{ version_id: string; content_hash: string } | null> {
  // Placeholder until Registry v2 is wired
  console.warn('[ext-gateway] resolveInstall placeholder for extension:', extensionId);
  return null;
}

// TODO: load manifest v2 for version_id and match endpoint
async function resolveEndpoint(
  _versionId: string,
  method: Method,
  pathname: string
): Promise<{ handler: string } | null> {
  console.warn('[ext-gateway] resolveEndpoint placeholder for', method, pathname);
  return null;
}

function pathnameFromParts(parts: string[]): string {
  return '/' + parts.filter(Boolean).join('/');
}

function getTimeoutMs(): number {
  const raw = process.env.EXT_GATEWAY_TIMEOUT_MS;
  const n = raw ? Number(raw) : 5000;
  return Number.isFinite(n) && n > 0 ? n : 5000;
}

async function handle(req: NextRequest, { params }: { params: { extensionId: string; path: string[] } }) {
  const method = req.method as Method;
  const requestId = getRequestId(req);

  try {
    const extensionId = params.extensionId;
    const pathParts = Array.isArray(params.path) ? params.path : [];
    const pathname = pathnameFromParts(pathParts);
    const url = new URL(req.url);

    const tenantId = await getTenantIdFromAuth(req);
    if (!tenantId) return json(401, { error: 'Unauthorized' });

    await assertAccess(tenantId, extensionId, method, pathname);

    const install = await resolveInstall(tenantId, extensionId);
    if (!install) return json(404, { error: 'Extension not installed' });

    const endpoint = await resolveEndpoint(install.version_id, method, pathname);
    if (!endpoint) return json(404, { error: 'Endpoint not found' });

    const timeoutMs = getTimeoutMs();

    // Body handling
    const bodyBuf = method === 'GET' ? undefined : Buffer.from(await req.arrayBuffer());
    const execReq = {
      context: {
        request_id: requestId,
        tenant_id: tenantId,
        extension_id: extensionId,
        version_id: install.version_id,
        content_hash: install.content_hash,
      },
      http: {
        method,
        path: pathname,
        query: Object.fromEntries(url.searchParams.entries()),
        headers: filterRequestHeaders(req, tenantId, extensionId, requestId),
        body_b64: bodyBuf ? bodyBuf.toString('base64') : undefined,
      },
      limits: { timeout_ms: timeoutMs },
      endpoint: endpoint.handler, // handler id/path inside the bundle
    };

    const runnerBase = process.env.RUNNER_BASE_URL;
    if (!runnerBase) {
      console.error('[ext-gateway] RUNNER_BASE_URL is not configured');
      return json(500, { error: 'Runner not configured' });
    }

    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeoutMs);

    const resp = await fetch(`${runnerBase.replace(/\/$/, '')}/v1/execute`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-request-id': requestId,
        // TODO: add short-lived service token for Runner auth
        // 'authorization': `Bearer ${await getRunnerServiceToken()}`
      },
      body: JSON.stringify(execReq),
      signal: controller.signal,
    }).catch((err) => {
      console.error('[ext-gateway] Runner fetch error:', err);
      throw err;
    }).finally(() => {
      clearTimeout(id);
    });

    if (!resp.ok) {
      console.error('[ext-gateway] Runner non-ok status:', resp.status);
      return json(502, { error: 'Runner error' });
    }

    const payload = await resp.json().catch(() => ({}));
    const status = typeof payload.status === 'number' ? payload.status : 200;
    const headers = filterResponseHeaders(payload.headers);
    const body = payload.body_b64 ? Buffer.from(payload.body_b64, 'base64') : undefined;

    return new NextResponse(body as any, { status, headers });
  } catch (err: any) {
    if (err?.name === 'AbortError') {
      return json(504, { error: 'Gateway timeout' });
    }
    console.error('[ext-gateway] Unhandled error:', err);
    return json(500, { error: 'Internal error' });
  }
}

export { handle as GET, handle as POST, handle as PUT, handle as PATCH, handle as DELETE };