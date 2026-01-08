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

/**
 * Call a platform API via uiProxy.
 * This is the proper way to make authenticated API calls from extensions.
 */
async function callPlatformApi(
  host: HostBindings,
  route: string,
  payload?: unknown
): Promise<{ status: number; data: unknown }> {
  const payloadBytes = payload ? encoder.encode(JSON.stringify(payload)) : null;

  try {
    const response = await host.uiProxy.callRoute(route, payloadBytes);

    // Parse the response
    if (response && response.length > 0) {
      const responseText = decoder.decode(new Uint8Array(response));
      try {
        const data = JSON.parse(responseText);
        return { status: 200, data };
      } catch {
        return { status: 200, data: responseText };
      }
    }
    return { status: 200, data: null };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { status: 500, data: { error: 'uiProxy call failed', detail: message } };
  }
}

// Router for different endpoints
interface Route {
  pattern: RegExp;
  handler: (request: ExecuteRequest, host: HostBindings, params: Record<string, string>) => Promise<ExecuteResponse>;
}

const routes: Route[] = [
  // List or Create reports - determined by body
  { pattern: /^\/reports$/, handler: handleReports },
  // Get, Update, or Delete a specific report - determined by body.__action
  { pattern: /^\/reports\/([0-9a-f-]+)$/, handler: handleReportById },
  // Execute a report
  { pattern: /^\/reports\/([0-9a-f-]+)\/execute$/, handler: handleExecuteReport },
  // Get schema
  { pattern: /^\/schema$/, handler: handleGetSchema },
  // Check access
  { pattern: /^\/access$/, handler: handleCheckAccess },
  // List audit logs (platform-reports)
  { pattern: /^\/audit/, handler: handleListAuditLogs },
  // Health check
  { pattern: /^\/health$/, handler: handleHealth },
  // Tenant Management API - pass through to host
  { pattern: /^\/api\/v1\/tenant-management\//, handler: handleTenantManagementProxy },
];

// Dispatcher for /reports endpoint
async function handleReports(request: ExecuteRequest, host: HostBindings, _params: Record<string, string>): Promise<ExecuteResponse> {
  if (request.http.body && request.http.body.length > 0) {
    try {
      const body = JSON.parse(decoder.decode(new Uint8Array(request.http.body)));
      if (body.__action === 'create' || body.name || body.report_definition) {
        return handleCreateReport(request, host, _params);
      }
    } catch { /* treat as list */ }
  }
  return handleListReports(request, host, _params);
}

// Dispatcher for /reports/:id endpoint
async function handleReportById(request: ExecuteRequest, host: HostBindings, params: Record<string, string>): Promise<ExecuteResponse> {
  if (request.http.body && request.http.body.length > 0) {
    try {
      const body = JSON.parse(decoder.decode(new Uint8Array(request.http.body)));
      if (body.__action === 'delete') return handleDeleteReport(request, host, params);
      if (body.__action === 'update' || body.name || body.report_definition || body.description !== undefined) {
        return handleUpdateReport(request, host, params);
      }
    } catch { /* treat as get */ }
  }
  return handleGetReportById(request, host, params);
}

export async function handler(request: ExecuteRequest, host: HostBindings): Promise<ExecuteResponse> {
  try {
    return await processRequest(request, host);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    await safeLog(host, 'error', `[nineminds-reporting] unhandled error build=${BUILD_STAMP} reason=${reason}`);
    return jsonResponse(
      { error: 'handler_failed', message: 'Nine Minds Reporting handler encountered an unexpected error.', detail: reason, build: BUILD_STAMP },
      { status: 500 }
    );
  }
}

async function processRequest(request: ExecuteRequest, host: HostBindings): Promise<ExecuteResponse> {
  const method = request.http.method || 'POST';
  const url = request.http.url || '/';
  const requestId = request.context.requestId ?? 'n/a';
  const tenantId = request.context.tenantId;
  const extensionId = request.context.extensionId;

  await safeLog(host, 'info', `[nineminds-reporting] request received tenant=${tenantId} extensionId=${extensionId} requestId=${requestId} method=${method} url=${url} build=${BUILD_STAMP}`);

  for (const route of routes) {
    const match = url.match(route.pattern);
    if (match) {
      const params: Record<string, string> = {};
      match.slice(1).forEach((value, index) => { params[`param${index}`] = value; });
      return await route.handler(request, host, params);
    }
  }

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
      'GET /audit - List audit logs',
      'GET /health - Health check',
    ],
    context: { tenantId, extensionId, requestId },
  });
}

// Handler: List all platform reports
async function handleListReports(request: ExecuteRequest, host: HostBindings): Promise<ExecuteResponse> {
  await safeLog(host, 'info', '[nineminds-reporting] listing platform reports via uiProxy');
  const result = await callPlatformApi(host, '/api/v1/platform-reports');
  return jsonResponse(result.data, { status: result.status });
}

// Handler: Create a new platform report
async function handleCreateReport(request: ExecuteRequest, host: HostBindings): Promise<ExecuteResponse> {
  await safeLog(host, 'info', '[nineminds-reporting] creating platform report via uiProxy');

  let body: unknown = {};
  if (request.http.body && request.http.body.length > 0) {
    try {
      body = JSON.parse(decoder.decode(new Uint8Array(request.http.body)));
    } catch { /* ignore */ }
  }

  const result = await callPlatformApi(host, '/api/v1/platform-reports', { ...body as object, __method: 'POST' });
  return jsonResponse(result.data, { status: result.status });
}

// Handler: Get report by ID
async function handleGetReportById(request: ExecuteRequest, host: HostBindings, params: Record<string, string>): Promise<ExecuteResponse> {
  const reportId = params.param0;
  await safeLog(host, 'info', `[nineminds-reporting] fetching report id=${reportId} via uiProxy`);
  const result = await callPlatformApi(host, `/api/v1/platform-reports/${reportId}`);
  return jsonResponse(result.data, { status: result.status });
}

// Handler: Update a report
async function handleUpdateReport(request: ExecuteRequest, host: HostBindings, params: Record<string, string>): Promise<ExecuteResponse> {
  const reportId = params.param0;
  await safeLog(host, 'info', `[nineminds-reporting] updating report id=${reportId} via uiProxy`);

  let body: unknown = {};
  if (request.http.body && request.http.body.length > 0) {
    try {
      body = JSON.parse(decoder.decode(new Uint8Array(request.http.body)));
    } catch { /* ignore */ }
  }

  const result = await callPlatformApi(host, `/api/v1/platform-reports/${reportId}`, { ...body as object, __method: 'PUT' });
  return jsonResponse(result.data, { status: result.status });
}

// Handler: Delete a report
async function handleDeleteReport(request: ExecuteRequest, host: HostBindings, params: Record<string, string>): Promise<ExecuteResponse> {
  const reportId = params.param0;
  await safeLog(host, 'info', `[nineminds-reporting] deleting report id=${reportId} via uiProxy`);
  const result = await callPlatformApi(host, `/api/v1/platform-reports/${reportId}`, { __method: 'DELETE' });
  return jsonResponse(result.data, { status: result.status });
}

// Handler: Execute a report
async function handleExecuteReport(request: ExecuteRequest, host: HostBindings, params: Record<string, string>): Promise<ExecuteResponse> {
  const reportId = params.param0;
  await safeLog(host, 'info', `[nineminds-reporting] executing report id=${reportId} via uiProxy`);

  let body: unknown = {};
  if (request.http.body && request.http.body.length > 0) {
    try {
      body = JSON.parse(decoder.decode(new Uint8Array(request.http.body)));
    } catch { /* ignore */ }
  }

  const result = await callPlatformApi(host, `/api/v1/platform-reports/${reportId}/execute`, body);
  return jsonResponse(result.data, { status: result.status });
}

// Handler: List audit logs
async function handleListAuditLogs(request: ExecuteRequest, host: HostBindings): Promise<ExecuteResponse> {
  const url = request.http.url || '/audit';
  // Extract query string from URL
  const queryStart = url.indexOf('?');
  const queryString = queryStart >= 0 ? url.substring(queryStart) : '';

  await safeLog(host, 'info', `[nineminds-reporting] listing audit logs via uiProxy`);
  const result = await callPlatformApi(host, `/api/v1/platform-reports/audit${queryString}`);
  return jsonResponse(result.data, { status: result.status });
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

// Handler: Proxy tenant-management API calls via uiProxy
async function handleTenantManagementProxy(request: ExecuteRequest, host: HostBindings, _params: Record<string, string>): Promise<ExecuteResponse> {
  const url = request.http.url || '';
  await safeLog(host, 'info', `[nineminds-reporting] proxying tenant-management request via uiProxy: ${url}`);

  let body: unknown = undefined;
  if (request.http.body && request.http.body.length > 0) {
    try {
      body = JSON.parse(decoder.decode(new Uint8Array(request.http.body)));
    } catch { /* ignore */ }
  }

  const result = await callPlatformApi(host, url, body);
  return jsonResponse(result.data, { status: result.status });
}

// Handler: Get schema
async function handleGetSchema(request: ExecuteRequest, host: HostBindings): Promise<ExecuteResponse> {
  await safeLog(host, 'info', '[nineminds-reporting] fetching schema via uiProxy');
  const result = await callPlatformApi(host, '/api/v1/platform-reports/schema');
  return jsonResponse(result.data, { status: result.status });
}

// Handler: Check access permissions
async function handleCheckAccess(request: ExecuteRequest, host: HostBindings): Promise<ExecuteResponse> {
  await safeLog(host, 'info', '[nineminds-reporting] checking access via uiProxy');

  let body: unknown = {};
  if (request.http.body && request.http.body.length > 0) {
    try {
      body = JSON.parse(decoder.decode(new Uint8Array(request.http.body)));
    } catch { /* ignore */ }
  }

  const result = await callPlatformApi(host, '/api/v1/platform-reports/access', body);
  return jsonResponse(result.data, { status: result.status });
}

async function safeLog(host: HostBindings, level: 'info' | 'warn' | 'error', message: string) {
  try {
    await host.logging[level](message);
  } catch {
    // Swallow logging errors to avoid cascading failures.
  }
}
