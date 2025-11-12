import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from 'server/src/lib/actions/user-actions/userActions';
import { hasPermission } from 'server/src/lib/auth/rbac';
import { getTenantFromAuth } from 'server/src/lib/extensions/gateway/auth';
import {
  createDebugStreamClient,
  getDebugStreamPrefix,
} from 'server/src/lib/extensions/debugStream/redis';

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

function json(status: number, body: unknown): NextResponse {
  return new NextResponse(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json',
    },
  });
}

class HttpResponseError extends Error {
  response: NextResponse;

  constructor(response: NextResponse) {
    super('HTTP_RESPONSE');
    this.response = response;
  }
}

async function assertAccess(
  req: NextRequest,
  tenantIdFromQuery: string | null,
): Promise<{ tenantId: string | null }> {
  const currentUser = await getCurrentUser();

  if (!currentUser) {
    throw new HttpResponseError(json(401, { error: 'Unauthorized' }));
  }

  let tenantFromAuth: string | null = null;
  try {
    tenantFromAuth = await getTenantFromAuth(req);
  } catch (err: unknown) {
    // For end-user initiated requests we often won't have x-alga-tenant headers.
    // Treat missing tenant header as null and fall back to the session tenant.
    if (!(err instanceof Error && err.message === 'unauthenticated')) {
      throw err;
    }
  }
  const effectiveTenant =
    tenantIdFromQuery || tenantFromAuth || currentUser.tenant || null;

  if (!effectiveTenant) {
    throw new HttpResponseError(json(401, { error: 'Unauthorized' }));
  }

  if (currentUser.tenant && currentUser.tenant !== effectiveTenant) {
    throw new HttpResponseError(json(401, { error: 'Unauthorized' }));
  }

  // Require extension read permission within tenant context
  const allowed = await hasPermission(currentUser, 'extension', 'read');
  if (!allowed) {
    throw new HttpResponseError(json(403, { error: 'Forbidden' }));
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

    const { tenantId } = await assertAccess(req, tenantIdParam);
    const normalizedInstall = installId?.trim().toLowerCase() || null;
    const normalizedRequest = requestId?.trim().toLowerCase() || null;
    const streamKeys = buildStreamKeys(extensionId, tenantId);
    if (streamKeys.length === 0) {
      return json(500, { error: 'Unable to determine debug stream key' });
    }

    const redisClient = await createDebugStreamClient();
    const stream = createSseStream({
      redisClient,
      streamKeys,
      extensionId,
      tenantId,
      installId: normalizedInstall,
      requestId: normalizedRequest,
    });

    return new Response(stream, {
      status: 200,
      headers: {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache, no-transform',
        connection: 'keep-alive',
      },
    });
  } catch (err: unknown) {
    if (err instanceof HttpResponseError) {
      return err.response;
    }
    if (err instanceof NextResponse || err instanceof Response) {
      return err;
    }
    console.error('[ext-debug] unexpected error', err);
    return json(500, { error: 'Internal error' });
  }
}

type DebugEvent = {
  ts: string;
  level: string;
  stream: string;
  tenantId?: string;
  extensionId?: string;
  installId?: string;
  requestId?: string;
  versionId?: string;
  contentHash?: string;
  message: string;
  truncated: boolean;
};

type StreamOptions = {
  redisClient: Awaited<ReturnType<typeof createDebugStreamClient>>;
  streamKeys: string[];
  extensionId: string;
  tenantId: string | null;
  installId: string | null;
  requestId: string | null;
};

function buildStreamKeys(extensionId: string, tenantId: string | null): string[] {
  const prefix = getDebugStreamPrefix();
  const normalizedExt = extensionId.toLowerCase();
  if (tenantId) {
    return [`${prefix}${tenantId.toLowerCase()}:${normalizedExt}`];
  }
  return [`${prefix}unknown:${normalizedExt}`];
}

function mapRedisEvent(
  fields: Record<string, string>,
  fallbackExtensionId: string,
  fallbackTenantId: string | null,
): DebugEvent {
  return {
    ts: fields.ts || new Date().toISOString(),
    level: fields.level || 'info',
    stream: fields.stream || 'log',
    tenantId: fields.tenant || fallbackTenantId || undefined,
    extensionId: fields.extension || fallbackExtensionId,
    installId: fields.install || undefined,
    requestId: fields.request || undefined,
    versionId: fields.version || undefined,
    contentHash: fields.content_hash || undefined,
    message: fields.message || '',
    truncated: fields.truncated === '1' || fields.truncated === 'true',
  };
}

function passthroughFilter(event: DebugEvent, opts: { installId: string | null; requestId: string | null }) {
  if (opts.installId && event.installId?.toLowerCase() !== opts.installId) {
    return false;
  }
  if (opts.requestId && event.requestId?.toLowerCase() !== opts.requestId) {
    return false;
  }
  return true;
}

function createSseStream(options: StreamOptions): ReadableStream {
  const encoder = new TextEncoder();
  const lastIds = new Map(options.streamKeys.map((key) => [key, '$']));

  let cleanup: (() => Promise<void>) | null = null;

  const stream = new ReadableStream({
    start(controller) {
      let closed = false;

      cleanup = async () => {
        if (closed) return;
        closed = true;
        await options.redisClient.quit().catch(() => options.redisClient.disconnect());
      };

      const pump = async () => {
        while (!closed) {
          try {
            const descriptors = options.streamKeys.map((key) => ({
              key,
              id: lastIds.get(key) ?? '$',
            }));
            const entries = await options.redisClient.xRead(descriptors, {
              BLOCK: 5000,
              COUNT: 100,
            });

            if (!entries) {
              continue;
            }

            for (const entry of entries) {
              const streamName = entry.name;
              for (const message of entry.messages) {
                lastIds.set(streamName, message.id);
                const event = mapRedisEvent(
                  message.message,
                  options.extensionId,
                  options.tenantId,
                );
                if (!passthroughFilter(event, { installId: options.installId, requestId: options.requestId })) {
                  continue;
                }
                controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
              }
            }
          } catch (err) {
            if (closed) {
              break;
            }
            console.error('[ext-debug] redis stream error', err);
            controller.error(err);
            if (cleanup) {
              await cleanup();
            }
            return;
          }
        }
      };

      void pump();
    },
    async cancel() {
      if (cleanup) {
        await cleanup();
      }
    },
  });

  return stream;
}
