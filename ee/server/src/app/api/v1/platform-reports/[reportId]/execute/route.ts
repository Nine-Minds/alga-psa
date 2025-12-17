/**
 * Platform Reports API - Execute Report endpoint
 *
 * POST /api/v1/platform-reports/:reportId/execute - Execute a platform report
 *
 * Access restricted to users from MASTER_BILLING_TENANT_ID only.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/actions/user-actions/userActions';
import { PlatformReportService } from '@ee/lib/platformReports';
import { ReportParameters } from 'server/src/lib/reports/core/types';

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
    console.log('[platform-reports/:id/execute] Extension call:', { extensionId, extensionTenant });
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
 * POST /api/v1/platform-reports/:reportId/execute
 * Execute a platform report and return results
 */
export async function POST(
  request: NextRequest,
  context: RouteContext
): Promise<NextResponse> {
  try {
    const masterTenantId = await assertMasterTenantAccess(request);
    const { reportId } = await context.params;

    const service = new PlatformReportService(masterTenantId);

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

    return NextResponse.json({
      success: true,
      data: result,
    });
  } catch (error) {
    console.error('[platform-reports/:id/execute] POST error:', error);

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

      if (error.message.includes('not found')) {
        return NextResponse.json(
          { success: false, error: error.message },
          { status: 404 }
        );
      }

      if (error.message.includes('inactive')) {
        return NextResponse.json(
          { success: false, error: error.message },
          { status: 400 }
        );
      }

      // Report permission errors (allowlist violations)
      if (error.name === 'ReportPermissionError') {
        return NextResponse.json(
          { success: false, error: error.message },
          { status: 400 }
        );
      }

      // Report execution errors
      if (error.name === 'ReportExecutionError') {
        return NextResponse.json(
          { success: false, error: error.message },
          { status: 500 }
        );
      }
    }

    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
