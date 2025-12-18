/**
 * Platform Reports API - List and Create endpoints
 *
 * GET  /api/v1/platform-reports - List all platform reports
 * POST /api/v1/platform-reports - Create a new platform report
 *
 * Access restricted to users from MASTER_BILLING_TENANT_ID only.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/actions/user-actions/userActions';
import {
  PlatformReportService,
  CreateReportInput,
  PlatformReportAuditService,
  extractClientInfo,
} from '@ee/lib/platformReports';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * CORS headers for extension iframe access
 */
function corsHeaders(request: NextRequest): HeadersInit {
  const origin = request.headers.get('origin') || '*';
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Credentials': 'true',
  };
}

function jsonResponse(data: unknown, init: ResponseInit & { request?: NextRequest } = {}): NextResponse {
  const headers = init.request ? corsHeaders(init.request) : {};
  return NextResponse.json(data, {
    ...init,
    headers: { ...headers, ...init.headers },
  });
}

/**
 * OPTIONS - CORS preflight
 */
export async function OPTIONS(request: NextRequest): Promise<NextResponse> {
  return new NextResponse(null, {
    status: 204,
    headers: corsHeaders(request),
  });
}

const MASTER_BILLING_TENANT_ID = process.env.MASTER_BILLING_TENANT_ID;

/**
 * Verify the caller has access to platform reports.
 *
 * SECURITY: Platform reports provide cross-tenant data access, so we MUST verify
 * that the user belongs to the master billing tenant. We cannot trust headers alone
 * as they can be spoofed by malicious clients.
 *
 * Returns the tenant ID to use for queries.
 */
async function assertMasterTenantAccess(request: NextRequest): Promise<string> {
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

  // Log extension context if present (for debugging, but don't trust it for auth)
  const extensionId = request.headers.get('x-alga-extension');
  if (extensionId) {
    console.log('[platform-reports] Extension call from master tenant:', {
      extensionId,
      userId: user.user_id,
    });
  }

  return MASTER_BILLING_TENANT_ID;
}

/**
 * GET /api/v1/platform-reports
 * List all platform reports
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const masterTenantId = await assertMasterTenantAccess(request);
    const user = await getCurrentUser();

    const service = new PlatformReportService(masterTenantId);
    const auditService = new PlatformReportAuditService(masterTenantId);

    // Get query parameters
    const { searchParams } = new URL(request.url);
    const category = searchParams.get('category') || undefined;
    const activeOnly = searchParams.get('activeOnly') !== 'false';

    const reports = await service.listReports({ category, activeOnly });

    // Log the list action
    const clientInfo = extractClientInfo(request);
    await auditService.logEvent({
      eventType: 'report.list',
      userId: user?.user_id,
      userEmail: user?.email,
      details: { category, activeOnly, count: reports.length },
      ...clientInfo,
    });

    return jsonResponse({
      success: true,
      data: reports,
    }, { request });
  } catch (error) {
    console.error('[platform-reports] GET error:', error);

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
    }

    return jsonResponse(
      { success: false, error: 'Internal server error' },
      { status: 500, request }
    );
  }
}

/**
 * POST /api/v1/platform-reports
 * Create a new platform report
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const masterTenantId = await assertMasterTenantAccess(request);
    const user = await getCurrentUser();

    const service = new PlatformReportService(masterTenantId);
    const auditService = new PlatformReportAuditService(masterTenantId);

    const body = await request.json() as CreateReportInput;

    // Validate required fields
    if (!body.name || typeof body.name !== 'string') {
      return jsonResponse(
        { success: false, error: 'name is required' },
        { status: 400, request }
      );
    }

    if (!body.report_definition || typeof body.report_definition !== 'object') {
      return jsonResponse(
        { success: false, error: 'report_definition is required' },
        { status: 400, request }
      );
    }

    const report = await service.createReport(body, user?.user_id);

    // Log the create action
    const clientInfo = extractClientInfo(request);
    await auditService.logEvent({
      eventType: 'report.create',
      userId: user?.user_id,
      userEmail: user?.email,
      reportId: report.report_id,
      reportName: report.name,
      details: { category: report.category },
      ...clientInfo,
    });

    return jsonResponse({
      success: true,
      data: report,
    }, { status: 201, request });
  } catch (error) {
    console.error('[platform-reports] POST error:', error);

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

      // Report permission errors (blocklist violations)
      if (error.name === 'ReportPermissionError') {
        return jsonResponse(
          { success: false, error: error.message },
          { status: 400, request }
        );
      }
    }

    return jsonResponse(
      { success: false, error: 'Internal server error' },
      { status: 500, request }
    );
  }
}
