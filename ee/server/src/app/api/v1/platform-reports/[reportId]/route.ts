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
import { PlatformReportService, UpdateReportInput } from '@ee/lib/platformReports';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MASTER_BILLING_TENANT_ID = process.env.MASTER_BILLING_TENANT_ID;

/**
 * Verify the caller has access to platform reports.
 * Accepts:
 * 1. User session from master billing tenant
 * 2. Internal extension calls (identified by x-alga-extension header) from any tenant
 *
 * Returns the tenant ID to use for queries.
 */
async function assertMasterTenantAccess(request: NextRequest): Promise<string> {
  if (!MASTER_BILLING_TENANT_ID) {
    throw new Error('MASTER_BILLING_TENANT_ID not configured on server');
  }

  // Check for extension call - extensions can access reports for their tenant
  const extensionId = request.headers.get('x-alga-extension');
  const extensionTenant = request.headers.get('x-alga-tenant');

  if (extensionId && extensionTenant) {
    // This is an internal call from an extension
    // For platform reports, we always use the master tenant for queries
    // but we log which extension made the call
    console.log('[platform-reports/:id] Extension call:', { extensionId, extensionTenant });
    return MASTER_BILLING_TENANT_ID;
  }

  // Standard user session auth
  const user = await getCurrentUser();

  if (!user) {
    throw new Error('Authentication required');
  }

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
    const { reportId } = await context.params;

    const service = new PlatformReportService(masterTenantId);
    const report = await service.getReport(reportId);

    if (!report) {
      return NextResponse.json(
        { success: false, error: 'Report not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      data: report,
    });
  } catch (error) {
    console.error('[platform-reports/:id] GET error:', error);

    if (error instanceof Error) {
      if (
        error.message.includes('Access denied') ||
        error.message.includes('Authentication')
      ) {
        return NextResponse.json(
          { success: false, error: error.message },
          { status: 403 }
        );
      }
    }

    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
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
    const { reportId } = await context.params;

    const service = new PlatformReportService(masterTenantId);
    const body = await request.json() as UpdateReportInput;

    const report = await service.updateReport(reportId, body);

    if (!report) {
      return NextResponse.json(
        { success: false, error: 'Report not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      data: report,
    });
  } catch (error) {
    console.error('[platform-reports/:id] PUT error:', error);

    if (error instanceof Error) {
      if (
        error.message.includes('Access denied') ||
        error.message.includes('Authentication')
      ) {
        return NextResponse.json(
          { success: false, error: error.message },
          { status: 403 }
        );
      }

      // Report permission errors (allowlist violations)
      if (error.name === 'ReportPermissionError') {
        return NextResponse.json(
          { success: false, error: error.message },
          { status: 400 }
        );
      }
    }

    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
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
    const { reportId } = await context.params;

    const service = new PlatformReportService(masterTenantId);
    const deleted = await service.deleteReport(reportId);

    if (!deleted) {
      return NextResponse.json(
        { success: false, error: 'Report not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      message: 'Report deleted',
    });
  } catch (error) {
    console.error('[platform-reports/:id] DELETE error:', error);

    if (error instanceof Error) {
      if (
        error.message.includes('Access denied') ||
        error.message.includes('Authentication')
      ) {
        return NextResponse.json(
          { success: false, error: error.message },
          { status: 403 }
        );
      }
    }

    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
