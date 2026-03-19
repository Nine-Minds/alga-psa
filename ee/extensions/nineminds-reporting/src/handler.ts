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
  // Feature flags
  { pattern: /^\/feature-flags$/, handler: handleFeatureFlags },
  { pattern: /^\/feature-flags\/(\d+)$/, handler: handleFeatureFlagById },
  { pattern: /^\/feature-flags\/(\d+)\/tenants$/, handler: handleFeatureFlagTenants },
  // Notifications
  { pattern: /^\/notifications\/resolve-recipients$/, handler: handleResolveRecipients },
  { pattern: /^\/notifications\/([0-9a-f-]+)\/stats$/, handler: handleNotificationStats },
  { pattern: /^\/notifications\/([0-9a-f-]+)$/, handler: handleNotificationById },
  { pattern: /^\/notifications$/, handler: handleNotifications },
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
    await safeLog(host, 'error', `[nineminds-control-panel] unhandled error build=${BUILD_STAMP} reason=${reason}`);
    return jsonResponse(
      { error: 'handler_failed', message: 'NineMinds Control Panel handler encountered an unexpected error.', detail: reason, build: BUILD_STAMP },
      { status: 500 }
    );
  }
}

async function processRequest(request: ExecuteRequest, host: HostBindings): Promise<ExecuteResponse> {
  const method = request.http.method || 'POST';
  const fullUrl = request.http.url || '/';
  const queryIdx = fullUrl.indexOf('?');
  const url = queryIdx >= 0 ? fullUrl.substring(0, queryIdx) : fullUrl;
  const requestId = request.context.requestId ?? 'n/a';
  const tenantId = request.context.tenantId;
  const extensionId = request.context.extensionId;

  await safeLog(host, 'info', `[nineminds-control-panel] request received tenant=${tenantId} extensionId=${extensionId} requestId=${requestId} method=${method} url=${fullUrl} build=${BUILD_STAMP}`);

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
    message: 'NineMinds Control Panel',
    version: '0.3.0',
    build: BUILD_STAMP,
    endpoints: [
      'GET /reports - List all platform reports',
      'POST /reports - Create a new report',
      'GET /reports/:id - Get report by ID',
      'PUT /reports/:id - Update a report',
      'DELETE /reports/:id - Delete a report',
      'POST /reports/:id/execute - Execute a report',
      'GET /feature-flags - List all feature flags',
      'POST /feature-flags - Create a new feature flag',
      'GET /feature-flags/:id - Get feature flag by ID',
      'PUT /feature-flags/:id - Update a feature flag',
      'DELETE /feature-flags/:id - Delete a feature flag',
      'POST /feature-flags/:id/tenants - Add/remove tenant from flag',
      'GET /notifications - List all notifications',
      'POST /notifications - Create a notification',
      'GET /notifications/:id - Get notification by ID',
      'PUT /notifications/:id - Update a notification',
      'DELETE /notifications/:id - Delete a notification',
      'GET /notifications/:id/stats - Get notification stats',
      'POST /notifications/resolve-recipients - Resolve matching users',
      'GET /audit - List audit logs',
      'GET /health - Health check',
    ],
    context: { tenantId, extensionId, requestId },
  });
}

// Handler: List all platform reports
async function handleListReports(request: ExecuteRequest, host: HostBindings): Promise<ExecuteResponse> {
  await safeLog(host, 'info', '[nineminds-control-panel] listing platform reports via uiProxy');
  const result = await callPlatformApi(host, '/api/v1/platform-reports');
  return jsonResponse(result.data, { status: result.status });
}

// Handler: Create a new platform report
async function handleCreateReport(request: ExecuteRequest, host: HostBindings): Promise<ExecuteResponse> {
  await safeLog(host, 'info', '[nineminds-control-panel] creating platform report via uiProxy');

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
  await safeLog(host, 'info', `[nineminds-control-panel] fetching report id=${reportId} via uiProxy`);
  const result = await callPlatformApi(host, `/api/v1/platform-reports/${reportId}`);
  return jsonResponse(result.data, { status: result.status });
}

// Handler: Update a report
async function handleUpdateReport(request: ExecuteRequest, host: HostBindings, params: Record<string, string>): Promise<ExecuteResponse> {
  const reportId = params.param0;
  await safeLog(host, 'info', `[nineminds-control-panel] updating report id=${reportId} via uiProxy`);

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
  await safeLog(host, 'info', `[nineminds-control-panel] deleting report id=${reportId} via uiProxy`);
  const result = await callPlatformApi(host, `/api/v1/platform-reports/${reportId}`, { __method: 'DELETE' });
  return jsonResponse(result.data, { status: result.status });
}

// Handler: Execute a report
async function handleExecuteReport(request: ExecuteRequest, host: HostBindings, params: Record<string, string>): Promise<ExecuteResponse> {
  const reportId = params.param0;
  await safeLog(host, 'info', `[nineminds-control-panel] executing report id=${reportId} via uiProxy`);

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

  await safeLog(host, 'info', `[nineminds-control-panel] listing audit logs via uiProxy`);
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
  await safeLog(host, 'info', `[nineminds-control-panel] proxying tenant-management request via uiProxy: ${url}`);

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
  await safeLog(host, 'info', '[nineminds-control-panel] fetching schema via uiProxy');
  const result = await callPlatformApi(host, '/api/v1/platform-reports/schema');
  return jsonResponse(result.data, { status: result.status });
}

// Handler: Check access permissions
async function handleCheckAccess(request: ExecuteRequest, host: HostBindings): Promise<ExecuteResponse> {
  await safeLog(host, 'info', '[nineminds-control-panel] checking access via uiProxy');

  let body: unknown = {};
  if (request.http.body && request.http.body.length > 0) {
    try {
      body = JSON.parse(decoder.decode(new Uint8Array(request.http.body)));
    } catch { /* ignore */ }
  }

  const result = await callPlatformApi(host, '/api/v1/platform-reports/access', body);
  return jsonResponse(result.data, { status: result.status });
}

// Dispatcher for /feature-flags endpoint
async function handleFeatureFlags(request: ExecuteRequest, host: HostBindings, _params: Record<string, string>): Promise<ExecuteResponse> {
  if (request.http.body && request.http.body.length > 0) {
    try {
      const body = JSON.parse(decoder.decode(new Uint8Array(request.http.body)));
      if (body.__action === 'create' || body.key) {
        return handleCreateFeatureFlag(request, host, _params);
      }
    } catch { /* treat as list */ }
  }
  return handleListFeatureFlags(request, host, _params);
}

// Handler: List all feature flags
async function handleListFeatureFlags(_request: ExecuteRequest, host: HostBindings, _params: Record<string, string>): Promise<ExecuteResponse> {
  await safeLog(host, 'info', '[nineminds-control-panel] listing feature flags via uiProxy');
  const result = await callPlatformApi(host, '/api/v1/platform-feature-flags');
  return jsonResponse(result.data, { status: result.status });
}

// Handler: Create a new feature flag
async function handleCreateFeatureFlag(request: ExecuteRequest, host: HostBindings, _params: Record<string, string>): Promise<ExecuteResponse> {
  await safeLog(host, 'info', '[nineminds-control-panel] creating feature flag via uiProxy');

  let body: unknown = {};
  if (request.http.body && request.http.body.length > 0) {
    try {
      body = JSON.parse(decoder.decode(new Uint8Array(request.http.body)));
    } catch { /* ignore */ }
  }

  const result = await callPlatformApi(host, '/api/v1/platform-feature-flags', { ...body as object, __method: 'POST' });
  return jsonResponse(result.data, { status: result.status });
}

// Dispatcher for /feature-flags/:id endpoint
async function handleFeatureFlagById(request: ExecuteRequest, host: HostBindings, params: Record<string, string>): Promise<ExecuteResponse> {
  if (request.http.body && request.http.body.length > 0) {
    try {
      const body = JSON.parse(decoder.decode(new Uint8Array(request.http.body)));
      if (body.__action === 'delete') return handleDeleteFeatureFlag(request, host, params);
      if (body.__action === 'update' || body.filters || body.active !== undefined) {
        return handleUpdateFeatureFlag(request, host, params);
      }
    } catch { /* treat as get */ }
  }
  return handleGetFeatureFlag(request, host, params);
}

// Handler: Get feature flag by ID
async function handleGetFeatureFlag(_request: ExecuteRequest, host: HostBindings, params: Record<string, string>): Promise<ExecuteResponse> {
  const flagId = params.param0;
  await safeLog(host, 'info', `[nineminds-control-panel] fetching feature flag id=${flagId} via uiProxy`);
  const result = await callPlatformApi(host, `/api/v1/platform-feature-flags/${flagId}`);
  return jsonResponse(result.data, { status: result.status });
}

// Handler: Update a feature flag
async function handleUpdateFeatureFlag(request: ExecuteRequest, host: HostBindings, params: Record<string, string>): Promise<ExecuteResponse> {
  const flagId = params.param0;
  await safeLog(host, 'info', `[nineminds-control-panel] updating feature flag id=${flagId} via uiProxy`);

  let body: unknown = {};
  if (request.http.body && request.http.body.length > 0) {
    try {
      body = JSON.parse(decoder.decode(new Uint8Array(request.http.body)));
    } catch { /* ignore */ }
  }

  const result = await callPlatformApi(host, `/api/v1/platform-feature-flags/${flagId}`, { ...body as object, __method: 'PATCH' });
  return jsonResponse(result.data, { status: result.status });
}

// Handler: Delete a feature flag
async function handleDeleteFeatureFlag(_request: ExecuteRequest, host: HostBindings, params: Record<string, string>): Promise<ExecuteResponse> {
  const flagId = params.param0;
  await safeLog(host, 'info', `[nineminds-control-panel] deleting feature flag id=${flagId} via uiProxy`);
  try {
    const result = await callPlatformApi(host, `/api/v1/platform-feature-flags/${flagId}`, { __method: 'DELETE' });
    return jsonResponse(result.data ?? { success: true, message: 'Flag deleted' }, { status: result.status });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    await safeLog(host, 'error', `[nineminds-control-panel] delete feature flag id=${flagId} failed: ${detail}`);
    return jsonResponse({ error: 'Delete failed', detail }, { status: 500 });
  }
}

// Handler: Manage tenants on a feature flag
async function handleFeatureFlagTenants(request: ExecuteRequest, host: HostBindings, params: Record<string, string>): Promise<ExecuteResponse> {
  const flagId = params.param0;
  await safeLog(host, 'info', `[nineminds-control-panel] managing tenants for feature flag id=${flagId} via uiProxy`);

  let body: unknown = {};
  if (request.http.body && request.http.body.length > 0) {
    try {
      body = JSON.parse(decoder.decode(new Uint8Array(request.http.body)));
    } catch { /* ignore */ }
  }

  const result = await callPlatformApi(host, `/api/v1/platform-feature-flags/${flagId}/tenants`, body);
  return jsonResponse(result.data, { status: result.status });
}

// ── Notification handlers ──

// Dispatcher for /notifications endpoint
async function handleNotifications(request: ExecuteRequest, host: HostBindings, _params: Record<string, string>): Promise<ExecuteResponse> {
  if (request.http.body && request.http.body.length > 0) {
    try {
      const body = JSON.parse(decoder.decode(new Uint8Array(request.http.body)));
      if (body.__action === 'create' || body.title) {
        return handleCreateNotification(request, host, _params);
      }
    } catch { /* treat as list */ }
  }
  return handleListNotifications(request, host, _params);
}

async function handleListNotifications(_request: ExecuteRequest, host: HostBindings, _params: Record<string, string>): Promise<ExecuteResponse> {
  await safeLog(host, 'info', '[nineminds-control-panel] listing notifications via uiProxy');
  const result = await callPlatformApi(host, '/api/v1/platform-notifications');
  return jsonResponse(result.data, { status: result.status });
}

async function handleCreateNotification(request: ExecuteRequest, host: HostBindings, _params: Record<string, string>): Promise<ExecuteResponse> {
  await safeLog(host, 'info', '[nineminds-control-panel] creating notification via uiProxy');

  let body: unknown = {};
  if (request.http.body && request.http.body.length > 0) {
    try {
      body = JSON.parse(decoder.decode(new Uint8Array(request.http.body)));
    } catch { /* ignore */ }
  }

  const result = await callPlatformApi(host, '/api/v1/platform-notifications', { ...body as object, __method: 'POST' });
  return jsonResponse(result.data, { status: result.status });
}

// Dispatcher for /notifications/:id endpoint
async function handleNotificationById(request: ExecuteRequest, host: HostBindings, params: Record<string, string>): Promise<ExecuteResponse> {
  if (request.http.body && request.http.body.length > 0) {
    try {
      const body = JSON.parse(decoder.decode(new Uint8Array(request.http.body)));
      if (body.__action === 'delete') return handleDeleteNotification(request, host, params);
      if (body.__action === 'update' || body.title || body.banner_content || body.detail_content) {
        return handleUpdateNotification(request, host, params);
      }
    } catch { /* treat as get */ }
  }
  return handleGetNotification(request, host, params);
}

async function handleGetNotification(_request: ExecuteRequest, host: HostBindings, params: Record<string, string>): Promise<ExecuteResponse> {
  const id = params.param0;
  await safeLog(host, 'info', `[nineminds-control-panel] fetching notification id=${id} via uiProxy`);
  const result = await callPlatformApi(host, `/api/v1/platform-notifications/${id}`);
  return jsonResponse(result.data, { status: result.status });
}

async function handleUpdateNotification(request: ExecuteRequest, host: HostBindings, params: Record<string, string>): Promise<ExecuteResponse> {
  const id = params.param0;
  await safeLog(host, 'info', `[nineminds-control-panel] updating notification id=${id} via uiProxy`);

  let body: unknown = {};
  if (request.http.body && request.http.body.length > 0) {
    try {
      body = JSON.parse(decoder.decode(new Uint8Array(request.http.body)));
    } catch { /* ignore */ }
  }

  const result = await callPlatformApi(host, `/api/v1/platform-notifications/${id}`, { ...body as object, __method: 'PUT' });
  return jsonResponse(result.data, { status: result.status });
}

async function handleDeleteNotification(_request: ExecuteRequest, host: HostBindings, params: Record<string, string>): Promise<ExecuteResponse> {
  const id = params.param0;
  await safeLog(host, 'info', `[nineminds-control-panel] deleting notification id=${id} via uiProxy`);
  const result = await callPlatformApi(host, `/api/v1/platform-notifications/${id}`, { __method: 'DELETE' });
  return jsonResponse(result.data, { status: result.status });
}

async function handleNotificationStats(_request: ExecuteRequest, host: HostBindings, params: Record<string, string>): Promise<ExecuteResponse> {
  const id = params.param0;
  await safeLog(host, 'info', `[nineminds-control-panel] fetching notification stats id=${id} via uiProxy`);
  const result = await callPlatformApi(host, `/api/v1/platform-notifications/${id}/stats`);
  return jsonResponse(result.data, { status: result.status });
}

async function handleResolveRecipients(request: ExecuteRequest, host: HostBindings, _params: Record<string, string>): Promise<ExecuteResponse> {
  await safeLog(host, 'info', '[nineminds-control-panel] resolving notification recipients via uiProxy');

  let body: unknown = {};
  if (request.http.body && request.http.body.length > 0) {
    try {
      body = JSON.parse(decoder.decode(new Uint8Array(request.http.body)));
    } catch { /* ignore */ }
  }

  const result = await callPlatformApi(host, '/api/v1/platform-notifications/resolve-recipients', { ...body as object, __method: 'POST' });
  return jsonResponse(result.data, { status: result.status });
}

async function safeLog(host: HostBindings, level: 'info' | 'warn' | 'error', message: string) {
  try {
    await host.logging[level](message);
  } catch {
    // Swallow logging errors to avoid cascading failures.
  }
}
