import type { ExecuteRequest, ExecuteResponse, HostBindings } from '@alga-psa/extension-runtime';

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

const BUILD_STAMP = new Date().toISOString();
const VERSION = 'v2.1.0-wit-wrapper';

export async function handler(request: ExecuteRequest, host: HostBindings): Promise<ExecuteResponse> {
  try {
    return await processRequest(request, host);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    await safeLog(host, 'error', `[client-portal-test] unhandled error build=${BUILD_STAMP} reason=${reason}`);
    return jsonResponse(
      {
        error: 'handler_failed',
        message: 'Client portal test handler encountered an unexpected error.',
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
  const extensionId = request.context.extensionId;
  const installId = request.context.installId ?? 'n/a';
  const configKeys = Object.keys(request.context.config ?? {});

  await safeLog(
    host,
    'info',
    `[client-portal-test] request received tenant=${tenantId} extensionId=${extensionId} requestId=${requestId} method=${method} url=${url} configKeys=${configKeys.length} build=${BUILD_STAMP}`
  );

  // Try to get user information
  let user: {
    tenantId: string;
    clientName: string;
    userId: string;
    userEmail: string;
    userName: string;
    userType: string;
    clientId?: string;
  } | null = null;
  let userError: string | null = null;
  try {
    user = await host.user.getUser();
    await safeLog(host, 'info', `[client-portal-test] user retrieved userId=${user.userId} userType=${user.userType}`);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    userError = reason;
    await safeLog(host, 'error', `[client-portal-test] failed to get user: ${reason}`);
  }

  // Return information about the request context
  const response = jsonResponse({
    ok: true,
    message: `Hello from the Client Portal Test Extension WASM handler! (${VERSION})`,
    context: {
      tenantId,
      extensionId,
      installId,
      requestId,
    },
    request: {
      method,
      url,
      path: url,
    },
    config: request.context.config ?? {},
    user: user ? {
      userId: user.userId,
      userName: user.userName,
      userEmail: user.userEmail,
      userType: user.userType,
      clientName: user.clientName,
      clientId: user.clientId,
    } : null,
    userError: userError,
    version: VERSION,
    build: BUILD_STAMP,
    timestamp: new Date().toISOString(),
  });

  await safeLog(
    host,
    'info',
    `[client-portal-test] request complete requestId=${requestId} status=${response.status} build=${BUILD_STAMP}`
  );

  return response;
}

async function safeLog(host: HostBindings, level: 'info' | 'warn' | 'error', message: string) {
  try {
    await host.logging[level](message);
  } catch {
    // Swallow logging errors to avoid cascading failures.
  }
}
