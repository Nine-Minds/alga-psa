import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from 'server/src/lib/actions/user-actions/userActions';
import { hasPermission } from 'server/src/lib/auth/rbac';
import { getTenantFromAuth } from 'server/src/lib/extensions/gateway/auth';

/**
 * EE Extension Debug Stream Gateway
 *
 * This route is implemented in the shared server/src/app App Router so that:
 * - We preserve a single Next.js app router root.
 * - We can route both CE/EE requests through the same API surface.
 * - EE-only behavior (debug stream access) is controlled via environment and RBAC.
 *
 * It proxies a filtered SSE stream from the Runner's `/internal/ext-debug/stream`.
 */

export const dynamic = 'force-dynamic';

function json(status: number, body: any): NextResponse {
  return new NextResponse(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json',
    },
  });
}

function buildRunnerFilterParam(params: {
  extensionId?: string | null;
  tenantId?: string | null;
  installId?: string | null;
  requestId?: string | null;
}): string {
  const parts: string[] = [];

  if (params.extensionId) parts.push(`extension:${params.extensionId}`);
  if (params.tenantId) parts.push(`tenant:${params.tenantId}`);
  if (params.installId) parts.push(`install:${params.installId}`);
  if (params.requestId) parts.push(`request:${params.requestId}`);

  return parts.join(',');
}

async function assertAccess(
  req: NextRequest,
  tenantIdFromQuery: string | null,
  extensionId: string | null
): Promise<{ tenantId: string | null }> {
  const currentUser = await getCurrentUser();

  if (!currentUser) {
    throw json(401, { error: 'Unauthorized' });
  }

  const tenantFromAuth = await getTenantFromAuth(req);
  const effectiveTenant =
    tenantIdFromQuery || tenantFromAuth || currentUser.tenant || null;

  if (!effectiveTenant) {
    throw json(401, { error: 'Unauthorized' });
  }

  if (currentUser.tenant && currentUser.tenant !== effectiveTenant) {
    throw json(401, { error: 'Unauthorized' });
  }

  // Require extension read permission within tenant context
  const allowed = await hasPermission(currentUser, 'extension', 'read');
  if (!allowed) {
    throw json(403, { error: 'Forbidden' });
  }

  // Future: enforce per-extension ownership/EE edition routing here using extensionId.
  return { tenantId: effectiveTenant };
}

export async function GET(req: NextRequest): Promise<Response> {
  try {
    const url = req.nextUrl;
    const searchParams = url.searchParams;

    const extensionId = searchParams.get('extensionId');
    const tenantIdParam = searchParams.get('tenantId');
    const installId = searchParams.get('installId');
    const requestId = searchParams.get('requestId');

    if (!extensionId) {
      return json(400, { error: 'extensionId is required' });
    }

    const { tenantId } = await assertAccess(req, tenantIdParam, extensionId);

    const runnerBase = process.env.RUNNER_BASE_URL;
    if (!runnerBase) {
      return json(500, { error: 'Runner not configured (missing RUNNER_BASE_URL)' });
    }

    const filter = buildRunnerFilterParam({
      extensionId,
      tenantId,
      installId,
      requestId,
    });

    if (!filter.includes('extension:')) {
      return json(400, { error: 'Invalid filter: extensionId is required in filter' });
    }

    const debugToken =
      process.env.RUNNER_DEBUG_STREAM_AUTH || process.env.RUNNER_SERVICE_TOKEN;
    if (!debugToken) {
      return json(500, {
        error: 'Debug stream auth not configured (RUNNER_DEBUG_STREAM_AUTH or RUNNER_SERVICE_TOKEN required)',
      });
    }

    const normalizedBase = runnerBase.endsWith('/')
      ? runnerBase.slice(0, -1)
      : runnerBase;
    const target = `${normalizedBase}/internal/ext-debug/stream`;

    const upstream = await fetch(target, {
      method: 'GET',
      headers: {
        'x-runner-auth': debugToken,
        'x-ext-debug-filter': filter,
        'cache-control': 'no-cache, no-transform',
      },
    });

    if (!upstream.ok) {
      const text = await upstream.text().catch(() => '');
      return json(upstream.status, {
        error: 'Runner debug stream unavailable',
        status: upstream.status,
        body: text || undefined,
      });
    }

    const readable = upstream.body;
    if (!readable) {
      return json(502, { error: 'Runner did not provide a stream body' });
    }

    // Relay SSE stream from runner directly to client
    const stream = new ReadableStream({
      start(controller) {
        const reader = readable.getReader();

        const pump = (): void => {
          reader
            .read()
            .then(({ done, value }) => {
              if (done) {
                controller.close();
                return;
              }
              if (value) {
                controller.enqueue(value);
              }
              pump();
            })
            .catch((err) => {
              // Logged server-side; surface as stream error client-side.
              console.error('[ext-debug] stream relay error', err);
              controller.error(err);
            });
        };

        pump();
      },
      cancel() {
        // Upstream reader will close when this stream is cancelled.
      },
    });

    return new Response(stream, {
      status: 200,
      headers: {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache, no-transform',
        connection: 'keep-alive',
      },
    });
  } catch (err: any) {
    if (err instanceof NextResponse || err instanceof Response) {
      return err;
    }
    console.error('[ext-debug] unexpected error', err);
    return json(500, { error: 'Internal error' });
  }
}