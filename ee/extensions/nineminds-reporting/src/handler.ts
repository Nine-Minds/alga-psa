import type { ExecuteRequest, ExecuteResponse, HostBindings } from '@alga-psa/extension-runtime';

// Inline encoders to avoid external dependency for jco componentize
const encoder = new TextEncoder();
const decoder = new TextDecoder();

/**
 * Extended request type that includes prefetched data from ext-proxy.
 * When ext-proxy prefetches platform API data server-side (with session auth),
 * it includes the result in prefetched_data so we don't need to make our own API calls.
 */
interface ExtendedExecuteRequest extends ExecuteRequest {
  prefetched_data?: {
    status: number;
    data: unknown;
  } | null;
}

/**
 * Get prefetched data from the request if available.
 * This data was fetched by ext-proxy server-side with proper session authentication.
 */
function getPrefetchedData(request: ExecuteRequest): { status: number; data: unknown } | null {
  const extended = request as ExtendedExecuteRequest;
  return extended.prefetched_data ?? null;
}

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
// NOTE: The iframeBridge always uses POST when proxying requests, so we route based on path only.
// For paths that could be different operations (like /reports for list vs create), we use the
// presence of a request body to distinguish. The UI should specify the intended action in the body.
interface Route {
  pattern: RegExp;
  handler: (request: ExecuteRequest, host: HostBindings, params: Record<string, string>) => Promise<ExecuteResponse>;
}

const routes: Route[] = [
  // List or Create reports - determined by body
  {
    pattern: /^\/reports$/,
    handler: handleReports,
  },
  // Get, Update, or Delete a specific report - determined by body.__action
  {
    pattern: /^\/reports\/([0-9a-f-]+)$/,
    handler: handleReportById,
  },
  // Execute a report
  {
    pattern: /^\/reports\/([0-9a-f-]+)\/execute$/,
    handler: handleExecuteReport,
  },
  // Get schema
  {
    pattern: /^\/schema$/,
    handler: handleGetSchema,
  },
  // Check access
  {
    pattern: /^\/access$/,
    handler: handleCheckAccess,
  },
  // List audit logs (platform-reports)
  {
    pattern: /^\/audit/,
    handler: handleListAuditLogs,
  },
  // Health check
  {
    pattern: /^\/health$/,
    handler: handleHealth,
  },
  // Tenant Management API - pass through to host
  {
    pattern: /^\/api\/v1\/tenant-management\//,
    handler: handleTenantManagementProxy,
  },
];

// Dispatcher for /reports endpoint
async function handleReports(request: ExecuteRequest, host: HostBindings, _params: Record<string, string>): Promise<ExecuteResponse> {
  // Check if there's a body with create data
  if (request.http.body && request.http.body.length > 0) {
    try {
      const body = JSON.parse(decoder.decode(new Uint8Array(request.http.body)));
      // If body has __action field, use that to determine operation
      if (body.__action === 'create' || body.name || body.report_definition) {
        return handleCreateReport(request, host, _params);
      }
    } catch {
      // If body parse fails, treat as list request
    }
  }
  return handleListReports(request, host, _params);
}

// Dispatcher for /reports/:id endpoint
async function handleReportById(request: ExecuteRequest, host: HostBindings, params: Record<string, string>): Promise<ExecuteResponse> {
  // Check body for action indicator
  if (request.http.body && request.http.body.length > 0) {
    try {
      const body = JSON.parse(decoder.decode(new Uint8Array(request.http.body)));
      const action = body.__action;
      if (action === 'delete') {
        return handleDeleteReport(request, host, params);
      }
      if (action === 'update' || body.name || body.report_definition || body.description !== undefined) {
        return handleUpdateReport(request, host, params);
      }
    } catch {
      // If body parse fails, treat as get request
    }
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
  const method = request.http.method || 'POST'; // iframeBridge always uses POST
  const url = request.http.url || '/';
  const requestId = request.context.requestId ?? 'n/a';
  const tenantId = request.context.tenantId;
  const extensionId = request.context.extensionId;

  await safeLog(
    host,
    'info',
    `[nineminds-reporting] request received tenant=${tenantId} extensionId=${extensionId} requestId=${requestId} method=${method} url=${url} build=${BUILD_STAMP}`
  );

  // Route the request based on URL pattern only (method is always POST from iframeBridge)
  for (const route of routes) {
    const match = url.match(route.pattern);
    if (match) {
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
    version: '0.3.0',
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
    context: {
      tenantId,
      extensionId,
      requestId,
    },
  });
}

// Handler: List all platform reports
async function handleListReports(request: ExecuteRequest, host: HostBindings): Promise<ExecuteResponse> {
  await safeLog(host, 'info', '[nineminds-reporting] listing platform reports');

  // Use prefetched data if available (fetched by ext-proxy with session auth)
  const prefetched = getPrefetchedData(request);
  if (prefetched) {
    await safeLog(host, 'info', '[nineminds-reporting] using prefetched data for list reports');
    return jsonResponse(prefetched.data, { status: prefetched.status });
  }

  // IMPORTANT: Do NOT fall back to direct HTTP calls.
  // The runner's http.fetch has a bug that causes panics ("resource has children").
  await safeLog(host, 'warn', '[nineminds-reporting] no prefetched data available for list reports');
  return jsonResponse(
    {
      success: false,
      error: 'Data not available',
      detail: 'The server-side prefetch timed out. Please refresh the page to retry.',
    },
    { status: 503 }
  );
}

// Handler: Create a new platform report
async function handleCreateReport(request: ExecuteRequest, host: HostBindings): Promise<ExecuteResponse> {
  await safeLog(host, 'info', '[nineminds-reporting] creating platform report');

  // Use prefetched data if available (ext-proxy already made the POST request)
  const prefetched = getPrefetchedData(request);
  if (prefetched) {
    await safeLog(host, 'info', '[nineminds-reporting] using prefetched data for create report');
    return jsonResponse(prefetched.data, { status: prefetched.status });
  }

  // IMPORTANT: Do NOT fall back to direct HTTP calls.
  await safeLog(host, 'warn', '[nineminds-reporting] no prefetched data available for create report');
  return jsonResponse(
    {
      success: false,
      error: 'Data not available',
      detail: 'The server-side prefetch timed out. Please refresh the page to retry.',
    },
    { status: 503 }
  );
}

// Handler: Get report by ID
async function handleGetReportById(
  request: ExecuteRequest,
  host: HostBindings,
  params: Record<string, string>
): Promise<ExecuteResponse> {
  const reportId = params.param0;
  await safeLog(host, 'info', `[nineminds-reporting] fetching report id=${reportId}`);

  // Use prefetched data if available
  const prefetched = getPrefetchedData(request);
  if (prefetched) {
    await safeLog(host, 'info', '[nineminds-reporting] using prefetched data for get report');
    return jsonResponse(prefetched.data, { status: prefetched.status });
  }

  // IMPORTANT: Do NOT fall back to direct HTTP calls.
  await safeLog(host, 'warn', '[nineminds-reporting] no prefetched data available for get report');
  return jsonResponse(
    {
      success: false,
      error: 'Data not available',
      detail: 'The server-side prefetch timed out. Please refresh the page to retry.',
    },
    { status: 503 }
  );
}

// Handler: Update a report
async function handleUpdateReport(
  request: ExecuteRequest,
  host: HostBindings,
  params: Record<string, string>
): Promise<ExecuteResponse> {
  const reportId = params.param0;
  await safeLog(host, 'info', `[nineminds-reporting] updating report id=${reportId}`);

  // Use prefetched data if available
  const prefetched = getPrefetchedData(request);
  if (prefetched) {
    await safeLog(host, 'info', '[nineminds-reporting] using prefetched data for update report');
    return jsonResponse(prefetched.data, { status: prefetched.status });
  }

  // IMPORTANT: Do NOT fall back to direct HTTP calls.
  await safeLog(host, 'warn', '[nineminds-reporting] no prefetched data available for update report');
  return jsonResponse(
    {
      success: false,
      error: 'Data not available',
      detail: 'The server-side prefetch timed out. Please refresh the page to retry.',
    },
    { status: 503 }
  );
}

// Handler: Delete a report
async function handleDeleteReport(
  request: ExecuteRequest,
  host: HostBindings,
  params: Record<string, string>
): Promise<ExecuteResponse> {
  const reportId = params.param0;
  await safeLog(host, 'info', `[nineminds-reporting] deleting report id=${reportId}`);

  // Use prefetched data if available
  const prefetched = getPrefetchedData(request);
  if (prefetched) {
    await safeLog(host, 'info', '[nineminds-reporting] using prefetched data for delete report');
    return jsonResponse(prefetched.data, { status: prefetched.status });
  }

  // IMPORTANT: Do NOT fall back to direct HTTP calls.
  await safeLog(host, 'warn', '[nineminds-reporting] no prefetched data available for delete report');
  return jsonResponse(
    {
      success: false,
      error: 'Data not available',
      detail: 'The server-side prefetch timed out. Please refresh the page to retry.',
    },
    { status: 503 }
  );
}

// Handler: Execute a report
async function handleExecuteReport(
  request: ExecuteRequest,
  host: HostBindings,
  params: Record<string, string>
): Promise<ExecuteResponse> {
  const reportId = params.param0;
  await safeLog(host, 'info', `[nineminds-reporting] executing report id=${reportId}`);

  // Use prefetched data if available
  const prefetched = getPrefetchedData(request);
  if (prefetched) {
    await safeLog(host, 'info', '[nineminds-reporting] using prefetched data for execute report');
    return jsonResponse(prefetched.data, { status: prefetched.status });
  }

  // IMPORTANT: Do NOT fall back to direct HTTP calls.
  await safeLog(host, 'warn', '[nineminds-reporting] no prefetched data available for execute report');
  return jsonResponse(
    {
      success: false,
      error: 'Data not available',
      detail: 'The server-side prefetch timed out. Please refresh the page to retry.',
    },
    { status: 503 }
  );
}

// Handler: List audit logs
async function handleListAuditLogs(request: ExecuteRequest, host: HostBindings): Promise<ExecuteResponse> {
  await safeLog(host, 'info', '[nineminds-reporting] listing audit logs');

  // Use prefetched data if available
  const prefetched = getPrefetchedData(request);
  if (prefetched) {
    await safeLog(host, 'info', '[nineminds-reporting] using prefetched data for audit logs');
    return jsonResponse(prefetched.data, { status: prefetched.status });
  }

  // IMPORTANT: Do NOT fall back to direct HTTP calls.
  await safeLog(host, 'warn', '[nineminds-reporting] no prefetched data available for audit logs');
  return jsonResponse(
    {
      success: false,
      error: 'Data not available',
      detail: 'The server-side prefetch timed out. Please refresh the page to retry.',
    },
    { status: 503 }
  );
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

// Handler: Proxy tenant-management API calls to the host
async function handleTenantManagementProxy(
  request: ExecuteRequest,
  host: HostBindings,
  _params: Record<string, string>
): Promise<ExecuteResponse> {
  const url = request.http.url || '';
  await safeLog(host, 'info', `[nineminds-reporting] proxying tenant-management request: ${url}`);

  // Use prefetched data if available
  const prefetched = getPrefetchedData(request);
  if (prefetched) {
    await safeLog(host, 'info', '[nineminds-reporting] using prefetched data for tenant-management');
    return jsonResponse(prefetched.data, { status: prefetched.status });
  }

  // IMPORTANT: Do NOT fall back to direct HTTP calls for tenant-management routes.
  // The runner's http.fetch has a bug that causes panics ("resource has children").
  // Instead, return an error asking the user to retry (prefetch should work on retry).
  await safeLog(host, 'warn', '[nineminds-reporting] no prefetched data available for tenant-management - cannot use fallback HTTP');
  return jsonResponse(
    {
      success: false,
      error: 'Data not available',
      detail: 'The server-side prefetch timed out. Please refresh the page to retry.',
      hint: 'This usually resolves on retry. If the problem persists, check server logs.',
    },
    { status: 503 }
  );
}

// Handler: Get schema
async function handleGetSchema(request: ExecuteRequest, host: HostBindings): Promise<ExecuteResponse> {
  await safeLog(host, 'info', '[nineminds-reporting] fetching schema');

  // Use prefetched data if available
  const prefetched = getPrefetchedData(request);
  if (prefetched) {
    await safeLog(host, 'info', '[nineminds-reporting] using prefetched data for schema');
    return jsonResponse(prefetched.data, { status: prefetched.status });
  }

  // IMPORTANT: Do NOT fall back to direct HTTP calls.
  await safeLog(host, 'warn', '[nineminds-reporting] no prefetched data available for schema');
  return jsonResponse(
    {
      success: false,
      error: 'Data not available',
      detail: 'The server-side prefetch timed out. Please refresh the page to retry.',
    },
    { status: 503 }
  );
}

// Handler: Check access permissions
async function handleCheckAccess(request: ExecuteRequest, host: HostBindings): Promise<ExecuteResponse> {
  await safeLog(host, 'info', '[nineminds-reporting] checking access');

  // Use prefetched data if available
  const prefetched = getPrefetchedData(request);
  if (prefetched) {
    await safeLog(host, 'info', '[nineminds-reporting] using prefetched data for access check');
    return jsonResponse(prefetched.data, { status: prefetched.status });
  }

  // IMPORTANT: Do NOT fall back to direct HTTP calls.
  await safeLog(host, 'warn', '[nineminds-reporting] no prefetched data available for access check');
  return jsonResponse(
    {
      success: false,
      error: 'Data not available',
      detail: 'The server-side prefetch timed out. Please refresh the page to retry.',
    },
    { status: 503 }
  );
}

async function safeLog(host: HostBindings, level: 'info' | 'warn' | 'error', message: string) {
  try {
    await host.logging[level](message);
  } catch {
    // Swallow logging errors to avoid cascading failures.
  }
}
