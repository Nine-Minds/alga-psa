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

export async function handler(request: ExecuteRequest, host: HostBindings): Promise<ExecuteResponse> {
  const method = request.http.method || 'GET';
  const url = request.http.url || '/';
  const requestId = request.context.requestId ?? 'n/a';
  const tenantId = request.context.tenantId;
  const configKeys = Object.keys(request.context.config ?? {});

  await host.logging.info(
    `[secrets-demo] request start tenant=${tenantId} requestId=${requestId} method=${method} url=${url} configKeys=${configKeys.length}`
  );

  let message: string;
  try {
    message = await host.secrets.get('greeting');
    await host.logging.info('[secrets-demo] greeting secret resolved; emitting response');
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    await host.logging.warn(
      `[secrets-demo] greeting secret missing, using fallback. requestId=${requestId} reason=${reason}`
    );
    message = 'hello';
  }

  const response = jsonResponse({ message, path: url, config: request.context.config ?? {} });
  await host.logging.info(`[secrets-demo] request complete requestId=${requestId} status=${response.status}`);
  return response;
}
