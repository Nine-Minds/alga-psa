/**
 * UI Proxy Internal Endpoint
 *
 * This endpoint handles uiProxy.callRoute() calls from the extension runner.
 * It validates runner auth and routes requests to internal services, bypassing
 * HTTP session requirements.
 *
 * POST /api/internal/ui-proxy/{extensionId}/{...route}
 *
 * Headers required:
 * - x-runner-auth: Runner service token
 * - x-alga-tenant: Tenant ID
 * - x-alga-extension: Extension ID
 */

import { NextRequest, NextResponse } from 'next/server';
import { PlatformReportService } from '@ee/lib/platformReports';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MASTER_BILLING_TENANT_ID = process.env.MASTER_BILLING_TENANT_ID;

type RouteParams = {
  extensionId: string;
  route?: string[];
};

/**
 * Verify runner auth token.
 */
function verifyRunnerAuth(request: NextRequest): boolean {
  const runnerToken = process.env.RUNNER_SERVICE_TOKEN || process.env.ALGA_AUTH_KEY;
  if (!runnerToken) {
    console.warn('[ui-proxy] No runner token configured');
    return false;
  }

  const providedToken = request.headers.get('x-runner-auth');
  if (!providedToken) {
    console.warn('[ui-proxy] No x-runner-auth header provided');
    return false;
  }

  return providedToken === runnerToken;
}

/**
 * Extract context from runner headers.
 */
function getRunnerContext(request: NextRequest): {
  tenantId: string | null;
  extensionId: string | null;
  requestId: string | null;
} {
  return {
    tenantId: request.headers.get('x-alga-tenant'),
    extensionId: request.headers.get('x-alga-extension'),
    requestId: request.headers.get('x-request-id'),
  };
}

/**
 * Handle platform-reports routes
 */
async function handlePlatformReports(
  method: string,
  routeParts: string[],
  tenantId: string,
  body: any,
): Promise<NextResponse> {
  // Only master tenant can access platform reports
  if (tenantId !== MASTER_BILLING_TENANT_ID) {
    return NextResponse.json(
      { success: false, error: 'Access denied: Platform reports require master tenant access' },
      { status: 403 }
    );
  }

  const service = new PlatformReportService(tenantId);

  // Route: /api/v1/platform-reports
  if (routeParts.length === 0) {
    if (method === 'GET') {
      const reports = await service.listReports({ activeOnly: true });
      return NextResponse.json({ success: true, data: reports });
    }
    if (method === 'POST') {
      const report = await service.createReport(body);
      return NextResponse.json({ success: true, data: report }, { status: 201 });
    }
  }

  // Route: /api/v1/platform-reports/{reportId}
  if (routeParts.length === 1) {
    const reportId = routeParts[0];
    if (method === 'GET') {
      const report = await service.getReport(reportId);
      if (!report) {
        return NextResponse.json({ success: false, error: 'Report not found' }, { status: 404 });
      }
      return NextResponse.json({ success: true, data: report });
    }
  }

  // Route: /api/v1/platform-reports/{reportId}/execute
  if (routeParts.length === 2 && routeParts[1] === 'execute') {
    const reportId = routeParts[0];
    if (method === 'POST') {
      const report = await service.getReport(reportId);
      if (!report) {
        return NextResponse.json({ success: false, error: 'Report not found' }, { status: 404 });
      }
      const results = await service.executeReport(reportId, body?.parameters);
      return NextResponse.json({ success: true, data: results });
    }
  }

  return NextResponse.json(
    { success: false, error: 'Route not found' },
    { status: 404 }
  );
}

/**
 * Main handler for ui-proxy requests
 */
async function handle(
  request: NextRequest,
  ctx: { params: RouteParams | Promise<RouteParams> },
): Promise<NextResponse> {
  const method = request.method;

  // Verify runner auth
  if (!verifyRunnerAuth(request)) {
    console.warn('[ui-proxy] Unauthorized request');
    return NextResponse.json(
      { success: false, error: 'Unauthorized' },
      { status: 401 }
    );
  }

  const { tenantId, extensionId, requestId } = getRunnerContext(request);

  if (!tenantId) {
    return NextResponse.json(
      { success: false, error: 'Missing tenant context' },
      { status: 400 }
    );
  }

  const routeParams = await ctx.params;
  const routeParts = routeParams.route || [];
  const fullRoute = '/' + routeParts.join('/');

  console.log('[ui-proxy] Request received', {
    method,
    extensionId: routeParams.extensionId,
    route: fullRoute,
    tenantId,
    requestId,
  });

  // Parse body for POST/PUT/PATCH
  let body: any = undefined;
  if (['POST', 'PUT', 'PATCH'].includes(method)) {
    try {
      const text = await request.text();
      if (text) {
        body = JSON.parse(text);
      }
    } catch (e) {
      // Body might not be JSON, that's ok
    }
  }

  try {
    // Route to appropriate handler based on the path
    // /api/v1/platform-reports/...
    if (routeParts[0] === 'api' && routeParts[1] === 'v1' && routeParts[2] === 'platform-reports') {
      const reportRouteParts = routeParts.slice(3); // Remove api/v1/platform-reports prefix
      return await handlePlatformReports(method, reportRouteParts, tenantId, body);
    }

    // Add more route handlers here as needed
    // e.g., /api/v1/tenant-management/...

    console.warn('[ui-proxy] Unknown route', { route: fullRoute });
    return NextResponse.json(
      { success: false, error: `Route not found: ${fullRoute}` },
      { status: 404 }
    );
  } catch (error) {
    console.error('[ui-proxy] Handler error:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
