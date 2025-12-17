import type { ExecuteRequest, ExecuteResponse, HostBindings } from '@alga-psa/extension-runtime';

// Inline encoders to avoid external dependency for jco componentize
const encoder = new TextEncoder();
const decoder = new TextDecoder();

function jsonResponse(body: unknown, init: Partial<ExecuteResponse> = {}): ExecuteResponse {
  const encoded = body instanceof Uint8Array ? body : encoder.encode(JSON.stringify(body));
  return {
    status: init.status ?? 200,
    headers: init.headers ?? [{ name: 'content-type', value: 'application/json' }],
    body: encoded,
  };
}

const BUILD_STAMP = new Date().toISOString();

// Router for different endpoints
interface Route {
  pattern: RegExp;
  method: string;
  handler: (request: ExecuteRequest, host: HostBindings, params: Record<string, string>) => Promise<ExecuteResponse>;
}

const routes: Route[] = [
  {
    pattern: /^\/reports$/,
    method: 'GET',
    handler: handleListReports,
  },
  {
    pattern: /^\/reports$/,
    method: 'POST',
    handler: handleCreateReport,
  },
  {
    pattern: /^\/reports\/([0-9a-f-]+)$/,
    method: 'GET',
    handler: handleGetReportById,
  },
  {
    pattern: /^\/reports\/([0-9a-f-]+)$/,
    method: 'PUT',
    handler: handleUpdateReport,
  },
  {
    pattern: /^\/reports\/([0-9a-f-]+)$/,
    method: 'DELETE',
    handler: handleDeleteReport,
  },
  {
    pattern: /^\/reports\/([0-9a-f-]+)\/execute$/,
    method: 'POST',
    handler: handleExecuteReport,
  },
  {
    pattern: /^\/health$/,
    method: 'GET',
    handler: handleHealth,
  },
];

export async function handler(request: ExecuteRequest, host: HostBindings): Promise<ExecuteResponse> {
  try {
    return await processRequest(request, host);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    await safeLog(host, 'error', `[nineminds-reporting] unhandled error build=${BUILD_STAMP} reason=${reason}`);
    return jsonResponse(
      {
        error: 'handler_failed',
        message: 'Nine Minds Reporting handler encountered an unexpected error.',
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

  await safeLog(
    host,
    'info',
    `[nineminds-reporting] request received tenant=${tenantId} extensionId=${extensionId} requestId=${requestId} method=${method} url=${url} build=${BUILD_STAMP}`
  );

  // Route the request
  for (const route of routes) {
    const match = url.match(route.pattern);
    if (match && method.toUpperCase() === route.method) {
      const params: Record<string, string> = {};
      match.slice(1).forEach((value, index) => {
        params[`param${index}`] = value;
      });
      return await route.handler(request, host, params);
    }
  }

  // Default response for unknown routes
  return jsonResponse({
    ok: true,
    message: 'Nine Minds Reporting Extension',
    version: '0.2.0',
    build: BUILD_STAMP,
    endpoints: [
      'GET /reports - List all platform reports',
      'POST /reports - Create a new report',
      'GET /reports/:id - Get report by ID',
      'PUT /reports/:id - Update a report',
      'DELETE /reports/:id - Delete a report',
      'POST /reports/:id/execute - Execute a report',
      'GET /health - Health check',
    ],
    context: {
      tenantId,
      extensionId,
      requestId,
    },
  });
}

/**
 * Get the host base URL from install config or context
 */
function getHostBaseUrl(request: ExecuteRequest): string {
  // Priority: install config > context hostUrl > default
  const configUrl = request.context.config?.hostBaseUrl;
  if (configUrl && typeof configUrl === 'string') {
    return configUrl;
  }

  // Try to get from context
  const contextUrl = (request.context as unknown as Record<string, unknown>).hostUrl;
  if (contextUrl && typeof contextUrl === 'string') {
    return contextUrl;
  }

  // Fallback to localhost
  return 'http://localhost:3000';
}

/**
 * Build auth headers to forward to the platform API
 */
function getAuthHeaders(request: ExecuteRequest): Array<{ name: string; value: string }> {
  const headers: Array<{ name: string; value: string }> = [
    { name: 'content-type', value: 'application/json' },
  ];

  // Forward tenant ID as header
  if (request.context.tenantId) {
    headers.push({ name: 'x-alga-tenant', value: request.context.tenantId });
  }

  // Forward extension ID as header - this allows the platform API to recognize
  // internal extension calls and bypass user session requirements
  if (request.context.extensionId) {
    headers.push({ name: 'x-alga-extension', value: request.context.extensionId });
  }

  // Forward any existing auth headers from the request
  const incomingHeaders = request.http.headers || [];
  for (const h of incomingHeaders) {
    const name = h.name.toLowerCase();
    if (name === 'authorization' || name === 'cookie') {
      headers.push(h);
    }
  }

  return headers;
}

/**
 * Call the platform reports API
 */
async function callPlatformReportsAPI(
  host: HostBindings,
  request: ExecuteRequest,
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  path: string,
  body?: unknown
): Promise<{ status: number; data: unknown }> {
  const baseUrl = getHostBaseUrl(request);
  const url = `${baseUrl}/api/v1/platform-reports${path}`;

  await safeLog(host, 'info', `[nineminds-reporting] calling platform API: ${method} ${url}`);

  const fetchRequest: Parameters<typeof host.http.fetch>[0] = {
    method,
    url,
    headers: getAuthHeaders(request),
  };

  if (body) {
    fetchRequest.body = encoder.encode(JSON.stringify(body));
  }

  const response = await host.http.fetch(fetchRequest);

  await safeLog(host, 'info', `[nineminds-reporting] platform API response: status=${response.status}`);

  let data: unknown;
  try {
    const text = decoder.decode(new Uint8Array(response.body ?? []));
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }

  return { status: response.status, data };
}

// Handler: List all platform reports
async function handleListReports(request: ExecuteRequest, host: HostBindings): Promise<ExecuteResponse> {
  await safeLog(host, 'info', '[nineminds-reporting] listing platform reports');

  try {
    const result = await callPlatformReportsAPI(host, request, 'GET', '');
    return jsonResponse(result.data, { status: result.status });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    await safeLog(host, 'error', `[nineminds-reporting] failed to list reports: ${reason}`);
    return jsonResponse(
      { success: false, error: 'Failed to fetch reports', detail: reason },
      { status: 500 }
    );
  }
}

// Handler: Create a new platform report
async function handleCreateReport(request: ExecuteRequest, host: HostBindings): Promise<ExecuteResponse> {
  await safeLog(host, 'info', '[nineminds-reporting] creating platform report');

  try {
    let body: unknown = {};
    if (request.http.body) {
      try {
        body = JSON.parse(decoder.decode(new Uint8Array(request.http.body)));
      } catch {
        return jsonResponse(
          { success: false, error: 'Invalid JSON body' },
          { status: 400 }
        );
      }
    }

    const result = await callPlatformReportsAPI(host, request, 'POST', '', body);
    return jsonResponse(result.data, { status: result.status });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    await safeLog(host, 'error', `[nineminds-reporting] failed to create report: ${reason}`);
    return jsonResponse(
      { success: false, error: 'Failed to create report', detail: reason },
      { status: 500 }
    );
  }
}

// Handler: Get report by ID
async function handleGetReportById(
  request: ExecuteRequest,
  host: HostBindings,
  params: Record<string, string>
): Promise<ExecuteResponse> {
  const reportId = params.param0;
  await safeLog(host, 'info', `[nineminds-reporting] fetching report id=${reportId}`);

  try {
    const result = await callPlatformReportsAPI(host, request, 'GET', `/${reportId}`);
    return jsonResponse(result.data, { status: result.status });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    await safeLog(host, 'error', `[nineminds-reporting] failed to get report: ${reason}`);
    return jsonResponse(
      { success: false, error: 'Failed to fetch report', detail: reason },
      { status: 500 }
    );
  }
}

// Handler: Update a report
async function handleUpdateReport(
  request: ExecuteRequest,
  host: HostBindings,
  params: Record<string, string>
): Promise<ExecuteResponse> {
  const reportId = params.param0;
  await safeLog(host, 'info', `[nineminds-reporting] updating report id=${reportId}`);

  try {
    let body: unknown = {};
    if (request.http.body) {
      try {
        body = JSON.parse(decoder.decode(new Uint8Array(request.http.body)));
      } catch {
        return jsonResponse(
          { success: false, error: 'Invalid JSON body' },
          { status: 400 }
        );
      }
    }

    const result = await callPlatformReportsAPI(host, request, 'PUT', `/${reportId}`, body);
    return jsonResponse(result.data, { status: result.status });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    await safeLog(host, 'error', `[nineminds-reporting] failed to update report: ${reason}`);
    return jsonResponse(
      { success: false, error: 'Failed to update report', detail: reason },
      { status: 500 }
    );
  }
}

// Handler: Delete a report
async function handleDeleteReport(
  request: ExecuteRequest,
  host: HostBindings,
  params: Record<string, string>
): Promise<ExecuteResponse> {
  const reportId = params.param0;
  await safeLog(host, 'info', `[nineminds-reporting] deleting report id=${reportId}`);

  try {
    const result = await callPlatformReportsAPI(host, request, 'DELETE', `/${reportId}`);
    return jsonResponse(result.data, { status: result.status });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    await safeLog(host, 'error', `[nineminds-reporting] failed to delete report: ${reason}`);
    return jsonResponse(
      { success: false, error: 'Failed to delete report', detail: reason },
      { status: 500 }
    );
  }
}

// Handler: Execute a report
async function handleExecuteReport(
  request: ExecuteRequest,
  host: HostBindings,
  params: Record<string, string>
): Promise<ExecuteResponse> {
  const reportId = params.param0;
  await safeLog(host, 'info', `[nineminds-reporting] executing report id=${reportId}`);

  try {
    let body: unknown = {};
    if (request.http.body) {
      try {
        body = JSON.parse(decoder.decode(new Uint8Array(request.http.body)));
      } catch {
        // Empty body is fine for execute
      }
    }

    const result = await callPlatformReportsAPI(host, request, 'POST', `/${reportId}/execute`, body);
    return jsonResponse(result.data, { status: result.status });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    await safeLog(host, 'error', `[nineminds-reporting] failed to execute report: ${reason}`);
    return jsonResponse(
      { success: false, error: 'Failed to execute report', detail: reason },
      { status: 500 }
    );
  }
}

// Handler: Health check
async function handleHealth(_request: ExecuteRequest, _host: HostBindings): Promise<ExecuteResponse> {
  return jsonResponse({
    ok: true,
    status: 'healthy',
    build: BUILD_STAMP,
    timestamp: new Date().toISOString(),
  });
}

async function safeLog(host: HostBindings, level: 'info' | 'warn' | 'error', message: string) {
  try {
    await host.logging[level](message);
  } catch {
    // Swallow logging errors to avoid cascading failures.
  }
}
