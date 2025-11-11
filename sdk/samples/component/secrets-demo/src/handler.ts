import type { ExecuteRequest, ExecuteResponse, HostBindings } from '@alga/extension-runtime';

// Inline jsonResponse to avoid external dependency for jco componentize
const encoder = new TextEncoder();
function jsonResponse(body: unknown, init: Partial<ExecuteResponse> = {}): ExecuteResponse {
  const encoded = body instanceof Uint8Array ? body : encoder.encode(JSON.stringify(body));
  return {
    status: init.status ?? 200,
    headers: init.headers ?? [{ name: 'content-type', value: 'application/json' }],
    body: encoded,
  };
}

const SECRET_KEY = 'greeting';
const BUILD_STAMP = '2025-11-11T17:34:00Z';

export async function handler(request: ExecuteRequest, host: HostBindings): Promise<ExecuteResponse> {
  try {
    return await processRequest(request, host);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    await safeLog(host, 'error', `[secrets-demo] unhandled error build=${BUILD_STAMP} reason=${reason}`);
    return jsonResponse(
      {
        error: 'handler_failed',
        message: 'Secrets demo handler encountered an unexpected error.',
        detail: reason,
        build: BUILD_STAMP,
      },
      { status: 500 }
    );
  }
}

async function processRequest(request: ExecuteRequest, host: HostBindings): Promise<ExecuteResponse> {
  const method = request.http.method || 'GET';
  const url = request.http.url || '/';
  const requestId = request.context.requestId ?? 'n/a';
  const tenantId = request.context.tenantId;
  const configKeys = Object.keys(request.context.config ?? {});

  const availableSecrets = await safeListSecrets(host);

  await safeLog(
    host,
    'info',
    `[secrets-demo] request start tenant=${tenantId} requestId=${requestId} method=${method} url=${url} configKeys=${configKeys.length} secrets=${availableSecrets.length} build=${BUILD_STAMP}`
  );

  if (!availableSecrets.includes(SECRET_KEY)) {
    await safeLog(
      host,
      'warn',
      `[secrets-demo] greeting secret not provisioned; build=${BUILD_STAMP} available=${availableSecrets.join(',')}`
    );
    return jsonResponse(
      {
        error: 'secret_missing',
        message: `Install secret "${SECRET_KEY}" is not defined.`,
        hint: `Add a secret named "${SECRET_KEY}" for this extension, then reload the demo.`,
        availableSecrets,
        build: BUILD_STAMP,
      },
      { status: 404 }
    );
  }

  let message: string | null = null;
  try {
    message = await host.secrets.get(SECRET_KEY);
    await safeLog(host, 'info', '[secrets-demo] greeting secret resolved; emitting response');
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    const normalized = reason.toLowerCase();
    const looksMissing = normalized.includes('missing') || normalized.includes('not found');

    if (looksMissing) {
      await safeLog(
        host,
        'warn',
        `[secrets-demo] greeting secret missing. requestId=${requestId} reason=${reason} availableSecrets=${availableSecrets.join(
          ','
        )}`
      );
      return jsonResponse(
        {
          error: 'secret_missing',
          message: `Install secret "${SECRET_KEY}" is not defined.`,
          hint: `Add a secret named "${SECRET_KEY}" for this extension, then reload the demo.`,
          availableSecrets,
          build: BUILD_STAMP,
        },
        { status: 404 }
      );
    }

    await safeLog(host, 'error', `[secrets-demo] greeting secret lookup failed. requestId=${requestId} reason=${reason}`);
    return jsonResponse(
      {
        error: 'secret_error',
        message: 'Failed to load greeting secret.',
        detail: reason,
        build: BUILD_STAMP,
      },
      { status: 500 }
    );
  }

  const response = jsonResponse({
    message,
    path: url,
    config: request.context.config ?? {},
    build: BUILD_STAMP,
  });
  await safeLog(
    host,
    'info',
    `[secrets-demo] request complete requestId=${requestId} status=${response.status} build=${BUILD_STAMP}`
  );
  return response;
}

async function safeListSecrets(host: HostBindings): Promise<string[]> {
  try {
    return await host.secrets.list();
  } catch {
    return [];
  }
}

async function safeLog(host: HostBindings, level: 'info' | 'warn' | 'error', message: string) {
  try {
    await host.logging[level](message);
  } catch {
    // Swallow logging errors to avoid cascading failures.
  }
}
