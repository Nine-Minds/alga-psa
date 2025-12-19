/**
 * Platform Reports API - Single Report endpoints
 *
 * GET    /api/v1/platform-reports/:reportId - Get a single report
 * PUT    /api/v1/platform-reports/:reportId - Update a report
 * DELETE /api/v1/platform-reports/:reportId - Delete a report (soft delete)
 *
 * Access restricted to users from MASTER_BILLING_TENANT_ID only.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/actions/user-actions/userActions';
import {
  PlatformReportService,
  UpdateReportInput,
  PlatformReportAuditService,
  extractClientInfo,
} from '@ee/lib/platformReports';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MASTER_BILLING_TENANT_ID = process.env.MASTER_BILLING_TENANT_ID;

/** CORS headers for extension iframe access */
function corsHeaders(request: NextRequest): HeadersInit {
  const origin = request.headers.get('origin') || '*';
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, PUT, DELETE, OPTIONS',
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
 * GET /api/v1/platform-reports/:reportId
 * Get a single platform report
 */
export async function GET(
  request: NextRequest,
  context: RouteContext
): Promise<NextResponse> {
  try {
    const masterTenantId = await assertMasterTenantAccess(request);
    const user = await getCurrentUser();
    const { reportId } = await context.params;

    const service = new PlatformReportService(masterTenantId);
    const auditService = new PlatformReportAuditService(masterTenantId);
    const report = await service.getReport(reportId);

    if (!report) {
      return jsonResponse(
        { success: false, error: 'Report not found' },
        { status: 404, request }
      );
    }

    // Log the view action
    const clientInfo = extractClientInfo(request);
    await auditService.logEvent({
      eventType: 'report.view',
      userId: user?.user_id,
      userEmail: user?.email,
      resourceType: 'report',
      resourceId: report.report_id,
      resourceName: report.name,
      ...clientInfo,
    });

    return jsonResponse({
      success: true,
      data: report,
    }, { request });
  } catch (error) {
    console.error('[platform-reports/:id] GET error:', error);

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
 * PUT /api/v1/platform-reports/:reportId
 * Update a platform report
 */
export async function PUT(
  request: NextRequest,
  context: RouteContext
): Promise<NextResponse> {
  try {
    const masterTenantId = await assertMasterTenantAccess(request);
    const user = await getCurrentUser();
    const { reportId } = await context.params;

    const service = new PlatformReportService(masterTenantId);
    const auditService = new PlatformReportAuditService(masterTenantId);
    const body = await request.json() as UpdateReportInput;

    const report = await service.updateReport(reportId, body);

    if (!report) {
      return jsonResponse(
        { success: false, error: 'Report not found' },
        { status: 404, request }
      );
    }

    // Log the update action
    const clientInfo = extractClientInfo(request);
    await auditService.logEvent({
      eventType: 'report.update',
      userId: user?.user_id,
      userEmail: user?.email,
      resourceType: 'report',
      resourceId: report.report_id,
      resourceName: report.name,
      details: { updatedFields: Object.keys(body) },
      ...clientInfo,
    });

    return jsonResponse({
      success: true,
      data: report,
    }, { request });
  } catch (error) {
    console.error('[platform-reports/:id] PUT error:', error);

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

/**
 * DELETE /api/v1/platform-reports/:reportId
 * Delete a platform report (soft delete)
 */
export async function DELETE(
  request: NextRequest,
  context: RouteContext
): Promise<NextResponse> {
  try {
    const masterTenantId = await assertMasterTenantAccess(request);
    const user = await getCurrentUser();
    const { reportId } = await context.params;

    const service = new PlatformReportService(masterTenantId);
    const auditService = new PlatformReportAuditService(masterTenantId);

    // Get report name before deletion for logging
    const report = await service.getReport(reportId);

    const deleted = await service.deleteReport(reportId);

    if (!deleted) {
      return jsonResponse(
        { success: false, error: 'Report not found' },
        { status: 404, request }
      );
    }

    // Log the delete action
    const clientInfo = extractClientInfo(request);
    await auditService.logEvent({
      eventType: 'report.delete',
      userId: user?.user_id,
      userEmail: user?.email,
      resourceType: 'report',
      resourceId: reportId,
      resourceName: report?.name,
      ...clientInfo,
    });

    return jsonResponse({
      success: true,
      message: 'Report deleted',
    }, { request });
  } catch (error) {
    console.error('[platform-reports/:id] DELETE error:', error);

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
