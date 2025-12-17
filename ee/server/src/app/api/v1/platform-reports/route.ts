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
import { PlatformReportService, CreateReportInput } from '@ee/lib/platformReports';

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
    console.log('[platform-reports] Extension call:', { extensionId, extensionTenant });
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

/**
 * GET /api/v1/platform-reports
 * List all platform reports
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const masterTenantId = await assertMasterTenantAccess(request);

    const service = new PlatformReportService(masterTenantId);

    // Get query parameters
    const { searchParams } = new URL(request.url);
    const category = searchParams.get('category') || undefined;
    const activeOnly = searchParams.get('activeOnly') !== 'false';

    const reports = await service.listReports({ category, activeOnly });

    return NextResponse.json({
      success: true,
      data: reports,
    });
  } catch (error) {
    console.error('[platform-reports] GET error:', error);

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
 * POST /api/v1/platform-reports
 * Create a new platform report
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const masterTenantId = await assertMasterTenantAccess(request);
    const user = await getCurrentUser();

    const service = new PlatformReportService(masterTenantId);

    const body = await request.json() as CreateReportInput;

    // Validate required fields
    if (!body.name || typeof body.name !== 'string') {
      return NextResponse.json(
        { success: false, error: 'name is required' },
        { status: 400 }
      );
    }

    if (!body.report_definition || typeof body.report_definition !== 'object') {
      return NextResponse.json(
        { success: false, error: 'report_definition is required' },
        { status: 400 }
      );
    }

    const report = await service.createReport(body, user?.user_id);

    return NextResponse.json({
      success: true,
      data: report,
    }, { status: 201 });
  } catch (error) {
    console.error('[platform-reports] POST error:', error);

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
