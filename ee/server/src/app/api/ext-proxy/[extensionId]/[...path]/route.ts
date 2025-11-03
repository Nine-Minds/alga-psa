import { NextRequest, NextResponse } from 'next/server';

import { filterRequestHeaders, getTimeoutMs, pathnameFromParts } from '../../../../../lib/extensions/lib/gateway-utils';
import { loadInstallConfigCached } from '../../../../../lib/extensions/lib/install-config-cache';
import { getCurrentUser } from 'server/src/lib/actions/user-actions/userActions';
import { hasPermission } from 'server/src/lib/auth/rbac';
import { getRunnerBackend, RunnerConfigError, RunnerRequestError } from '../../../../../lib/extensions/runner/backend';

export const dynamic = 'force-dynamic';

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

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

async function getTenantIdFromAuth(_req: NextRequest): Promise<string | null> {
  if (process.env.NODE_ENV !== 'production') {
    return 'tenant-dev';
  }
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

export async function handle(
  req: NextRequest,
  { params }: { params: { extensionId: string; path: string[] } }
) {
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
      console.error('[ext-proxy] Missing content hash', { tenantId, extensionId });
      return json(502, { error: 'Extension bundle unavailable' });
    }

    const timeoutMs = getTimeoutMs();
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
      providers: installConfig.providers,
      secret_envelope: installConfig.secretEnvelope ?? undefined,
      endpoint: `ui-proxy:${pathname}`,
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

    return new NextResponse(runnerResp.body as any, {
      status: runnerResp.status,
      headers: runnerResp.headers,
    });
  } catch (err: any) {
    if (err instanceof AccessError) {
      return json(err.status, { error: err.message });
    }
    if (err instanceof RunnerConfigError) {
      console.error('[ext-proxy] Runner configuration error:', err.message);
      return json(500, { error: 'Runner not configured' });
    }
    if (err instanceof RunnerRequestError) {
      console.error('[ext-proxy] Runner request error:', err.message, { backend: err.backend, status: err.status });
      return json(502, { error: 'Runner error' });
    }
    if (err?.name === 'AbortError') {
      return json(504, { error: 'Gateway timeout' });
    }
    console.error('[ext-proxy] Unhandled error:', err);
    return json(500, { error: 'Internal error' });
  }
}

export { handle as GET, handle as POST, handle as PUT, handle as PATCH, handle as DELETE };
