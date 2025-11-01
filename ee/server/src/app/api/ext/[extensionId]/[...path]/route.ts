import { NextRequest, NextResponse } from 'next/server';

import { matchEndpoint, pathnameFromParts, filterRequestHeaders, filterResponseHeaders, getTimeoutMs } from '../../../../../lib/extensions/lib/gateway-utils';
import { getRegistryFacade } from '../../../../../lib/extensions/lib/gateway-registry';
import { loadInstallConfigCached } from '../../../../../lib/extensions/lib/install-config-cache';
import { getCurrentUser } from 'server/src/lib/actions/user-actions/userActions';
import { hasPermission } from 'server/src/lib/auth/rbac';
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


// TODO: wire to real auth/session
// In non-production, return a deterministic tenant for local testing.
// In production, return null (401 will be returned by caller).
// Reference: ee/docs/extension-system/api-routing-guide.md
async function getTenantIdFromAuth(_req: NextRequest): Promise<string | null> {
  if (process.env.NODE_ENV !== 'production') {
    return 'tenant-dev';
  }
  // TODO: integrate with real auth/session to resolve tenant context
  return null;
}

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

async function assertAccess(tenantId: string, method: Method): Promise<void> {
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

  try {
    const extensionId = params.extensionId;
    const pathParts = Array.isArray(params.path) ? params.path : [];
    const pathname = pathnameFromParts(pathParts);
    const url = new URL(req.url);

    const tenantId = await getTenantIdFromAuth(req);
    if (!tenantId) return json(401, { error: 'Unauthorized' });

    await assertAccess(tenantId, method);

    const installConfig = await loadInstallConfigCached(tenantId, extensionId);
    if (!installConfig) return json(404, { error: 'Extension not installed' });
    if (!installConfig.contentHash) {
      console.error('[ext-gateway] Missing content hash for install', { tenantId, extensionId });
      return json(502, { error: 'Extension bundle unavailable' });
    }

    const endpoint = await resolveEndpoint(installConfig.versionId, method, pathname);
    if (!endpoint) return json(404, { error: 'Endpoint not found' });

    const timeoutMs = getTimeoutMs();

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
    };

    const runnerBase = process.env.RUNNER_BASE_URL;
    if (!runnerBase) {
      console.error('[ext-gateway] RUNNER_BASE_URL is not configured');
      return json(500, { error: 'Runner not configured' });
    }

    const runnerHeaders: Record<string, string> = {
      'content-type': 'application/json',
      'x-request-id': requestId,
      // TODO: add short-lived service token for Runner auth
    };
    if (installConfig.configVersion) {
      runnerHeaders['x-ext-config-version'] = installConfig.configVersion;
    }
    if (installConfig.secretsVersion) {
      runnerHeaders['x-ext-secrets-version'] = installConfig.secretsVersion;
    }

    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeoutMs);

    const resp = await fetch(`${runnerBase.replace(/\/$/, '')}/v1/execute`, {
      method: 'POST',
      headers: runnerHeaders,
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
    if (err instanceof AccessError) {
      return json(err.status, { error: err.message });
    }
    if (err?.name === 'AbortError') {
      return json(504, { error: 'Gateway timeout' });
    }
    console.error('[ext-gateway] Unhandled error:', err);
    return json(500, { error: 'Internal error' });
  }
}

export { handle as GET, handle as POST, handle as PUT, handle as PATCH, handle as DELETE };
