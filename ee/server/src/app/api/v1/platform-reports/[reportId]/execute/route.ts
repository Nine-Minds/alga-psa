/**
 * Platform Reports API - Execute Report endpoint
 *
 * POST /api/v1/platform-reports/:reportId/execute - Execute a platform report
 *
 * Access restricted to users from MASTER_BILLING_TENANT_ID only.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/actions/user-actions/userActions';
import {
  PlatformReportService,
  PlatformReportAuditService,
  extractClientInfo,
} from '@ee/lib/platformReports';
import { ReportParameters } from 'server/src/lib/reports/core/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MASTER_BILLING_TENANT_ID = process.env.MASTER_BILLING_TENANT_ID;

/** CORS headers for extension iframe access */
function corsHeaders(request: NextRequest): HeadersInit {
  const origin = request.headers.get('origin') || '*';
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Credentials': 'true',
  };
}

function jsonResponse(data: unknown, init: ResponseInit & { request?: NextRequest } = {}): NextResponse {
  const headers = init.request ? corsHeaders(init.request) : {};
  return NextResponse.json(data, { ...init, headers: { ...headers, ...init.headers } });
}

export async function OPTIONS(request: NextRequest): Promise<NextResponse> {
  return new NextResponse(null, { status: 204, headers: corsHeaders(request) });
}

/**
 * Verify the caller has access to platform reports.
 *
 * SECURITY: Platform reports provide cross-tenant data access, so we MUST verify
 * that the user belongs to the master billing tenant. We cannot trust headers alone
 * as they can be spoofed by malicious clients.
 *
 * Returns the tenant ID to use for queries.
 */
async function assertMasterTenantAccess(_request: NextRequest): Promise<string> {
  if (!MASTER_BILLING_TENANT_ID) {
    throw new Error('MASTER_BILLING_TENANT_ID not configured on server');
  }

  // ALWAYS validate the user session - headers can be spoofed!
  const user = await getCurrentUser();

  if (!user) {
    throw new Error('Authentication required');
  }

  // User MUST be from the master billing tenant to access cross-tenant reports
  if (user.tenant !== MASTER_BILLING_TENANT_ID) {
    throw new Error('Access denied: Platform reports require master tenant access');
  }

  return MASTER_BILLING_TENANT_ID;
}

interface RouteContext {
  params: Promise<{ reportId: string }>;
}

/**
 * POST /api/v1/platform-reports/:reportId/execute
 * Execute a platform report and return results
 */
export async function POST(
  request: NextRequest,
  context: RouteContext
): Promise<NextResponse> {
  try {
    const masterTenantId = await assertMasterTenantAccess(request);
    const user = await getCurrentUser();
    const { reportId } = await context.params;

    const service = new PlatformReportService(masterTenantId);
    const auditService = new PlatformReportAuditService(masterTenantId);

    // Get optional parameters from request body
    let parameters: ReportParameters = {};
    try {
      const body = await request.json();
      if (body && typeof body === 'object' && 'parameters' in body) {
        parameters = body.parameters as ReportParameters;
      } else if (body && typeof body === 'object') {
        // Allow passing parameters directly in body
        parameters = body as ReportParameters;
      }
    } catch {
      // No body or invalid JSON, use default empty parameters
    }

    const result = await service.executeReport(reportId, parameters);

    // Log the execute action
    const clientInfo = extractClientInfo(request);
    await auditService.logEvent({
      eventType: 'report.execute',
      userId: user?.user_id,
      userEmail: user?.email,
      reportId: reportId,
      reportName: result.reportName,
      details: {
        parameters,
        executionTime: result.metadata?.executionTime,
        metricsCount: Object.keys(result.metrics || {}).length,
      },
      ...clientInfo,
    });

    return jsonResponse({
      success: true,
      data: result,
    }, { request });
  } catch (error) {
    console.error('[platform-reports/:id/execute] POST error:', error);

    if (error instanceof Error) {
      if (
        error.message.includes('Access denied') ||
        error.message.includes('Authentication')
      ) {
        return jsonResponse(
          { success: false, error: error.message },
          { status: 403, request }
        );
      }

      if (error.message.includes('not found')) {
        return jsonResponse(
          { success: false, error: error.message },
          { status: 404, request }
        );
      }

      if (error.message.includes('inactive')) {
        return jsonResponse(
          { success: false, error: error.message },
          { status: 400, request }
        );
      }

      // Report permission errors (blocklist violations)
      if (error.name === 'ReportPermissionError') {
        return jsonResponse(
          { success: false, error: error.message },
          { status: 400, request }
        );
      }

      // Report execution errors
      if (error.name === 'ReportExecutionError') {
        return jsonResponse(
          { success: false, error: error.message },
          { status: 500, request }
        );
      }
    }

    return jsonResponse(
      { success: false, error: 'Internal server error' },
      { status: 500, request }
    );
  }
}
