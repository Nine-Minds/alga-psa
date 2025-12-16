import type { ExecuteRequest, ExecuteResponse, HostBindings } from '@alga-psa/extension-runtime';

// Inline jsonResponse to avoid external dependency for jco componentize
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
    handler: handleGetReports,
  },
  {
    pattern: /^\/reports\/(\w+)$/,
    method: 'GET',
    handler: handleGetReportById,
  },
  {
    pattern: /^\/reports\/generate$/,
    method: 'POST',
    handler: handleGenerateReport,
  },
  {
    pattern: /^\/external-data$/,
    method: 'GET',
    handler: handleFetchExternalData,
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
    version: '0.1.0',
    build: BUILD_STAMP,
    endpoints: [
      'GET /reports - List all reports',
      'GET /reports/:id - Get report by ID',
      'POST /reports/generate - Generate a new report',
      'GET /external-data - Fetch data from external API',
      'GET /health - Health check',
    ],
    context: {
      tenantId,
      extensionId,
      requestId,
    },
  });
}

// Handler: Get list of reports
async function handleGetReports(request: ExecuteRequest, host: HostBindings): Promise<ExecuteResponse> {
  await safeLog(host, 'info', '[nineminds-reporting] fetching reports list');

  // Mock data - in real implementation, this would fetch from storage or external API
  const reports = [
    { id: 'rpt-001', name: 'Monthly Revenue Report', status: 'completed', createdAt: '2024-01-15' },
    { id: 'rpt-002', name: 'Ticket Volume Analysis', status: 'completed', createdAt: '2024-01-14' },
    { id: 'rpt-003', name: 'SLA Compliance Report', status: 'pending', createdAt: '2024-01-13' },
    { id: 'rpt-004', name: 'Resource Utilization', status: 'completed', createdAt: '2024-01-12' },
  ];

  return jsonResponse({
    ok: true,
    reports,
    total: reports.length,
  });
}

// Handler: Get report by ID
async function handleGetReportById(
  request: ExecuteRequest,
  host: HostBindings,
  params: Record<string, string>
): Promise<ExecuteResponse> {
  const reportId = params.param0;
  await safeLog(host, 'info', `[nineminds-reporting] fetching report id=${reportId}`);

  // Mock data
  const report = {
    id: reportId,
    name: 'Monthly Revenue Report',
    status: 'completed',
    createdAt: '2024-01-15',
    data: {
      totalRevenue: 125000,
      ticketsClosed: 342,
      avgResolutionTime: '4.2 hours',
      customerSatisfaction: 4.7,
    },
    charts: [
      { type: 'line', title: 'Revenue Trend', dataPoints: 30 },
      { type: 'bar', title: 'Tickets by Category', dataPoints: 8 },
    ],
  };

  return jsonResponse({
    ok: true,
    report,
  });
}

// Handler: Generate a new report
async function handleGenerateReport(request: ExecuteRequest, host: HostBindings): Promise<ExecuteResponse> {
  await safeLog(host, 'info', '[nineminds-reporting] generating new report');

  // Parse request body if present
  let reportConfig: Record<string, unknown> = {};
  if (request.http.body) {
    try {
      reportConfig = JSON.parse(decoder.decode(new Uint8Array(request.http.body)));
    } catch {
      return jsonResponse({ error: 'invalid_body', message: 'Request body must be valid JSON' }, { status: 400 });
    }
  }

  // Mock report generation
  const newReport = {
    id: `rpt-${Date.now()}`,
    name: reportConfig.name || 'New Report',
    type: reportConfig.type || 'general',
    status: 'processing',
    createdAt: new Date().toISOString(),
    estimatedCompletion: new Date(Date.now() + 60000).toISOString(),
  };

  return jsonResponse({
    ok: true,
    message: 'Report generation started',
    report: newReport,
  });
}

// Handler: Fetch external data using HTTP capability
async function handleFetchExternalData(request: ExecuteRequest, host: HostBindings): Promise<ExecuteResponse> {
  await safeLog(host, 'info', '[nineminds-reporting] fetching external data via http.fetch');

  try {
    // Example: Fetch a dad joke from external API (for demo purposes)
    // In real reporting, this would fetch from reporting data sources
    const externalResponse = await host.http.fetch({
      method: 'GET',
      url: 'https://icanhazdadjoke.com/',
      headers: [
        { name: 'Accept', value: 'application/json' },
        { name: 'User-Agent', value: 'NineMindsReporting/0.1.0' },
      ],
    });

    await safeLog(host, 'info', `[nineminds-reporting] http.fetch response status=${externalResponse.status}`);

    if (externalResponse.status !== 200) {
      return jsonResponse(
        {
          ok: false,
          error: 'external_api_error',
          message: `External API returned status ${externalResponse.status}`,
        },
        { status: 502 }
      );
    }

    // Parse the response
    let externalData: unknown = null;
    if (externalResponse.body) {
      try {
        externalData = JSON.parse(decoder.decode(new Uint8Array(externalResponse.body)));
      } catch {
        externalData = { raw: decoder.decode(new Uint8Array(externalResponse.body)) };
      }
    }

    return jsonResponse({
      ok: true,
      message: 'External data fetched successfully',
      source: 'https://icanhazdadjoke.com/',
      data: externalData,
      fetchedAt: new Date().toISOString(),
    });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    await safeLog(host, 'error', `[nineminds-reporting] http.fetch failed: ${reason}`);
    return jsonResponse(
      {
        ok: false,
        error: 'fetch_failed',
        message: 'Failed to fetch external data',
        detail: reason,
      },
      { status: 500 }
    );
  }
}

// Handler: Health check
async function handleHealth(request: ExecuteRequest, host: HostBindings): Promise<ExecuteResponse> {
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
