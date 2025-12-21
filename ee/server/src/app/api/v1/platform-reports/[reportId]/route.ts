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

/**
 * Internal user info from trusted ext-proxy prefetch requests.
 */
interface InternalUserInfo {
  user_id: string;
  tenant: string;
  email: string;
}

/**
 * Check if this is an internal request from ext-proxy with trusted user info.
 */
function getInternalUserInfo(request: NextRequest): InternalUserInfo | null {
  const internalRequest = request.headers.get('x-internal-request');
  if (internalRequest !== 'ext-proxy-prefetch') {
    return null;
  }

  const userId = request.headers.get('x-internal-user-id');
  const tenant = request.headers.get('x-internal-user-tenant');
  const email = request.headers.get('x-internal-user-email') || '';

  if (!userId || !tenant) {
    return null;
  }

  return { user_id: userId, tenant, email };
}

/**
 * Verify the caller has access to platform reports.
 *
 * SECURITY: Platform reports provide cross-tenant data access, so we MUST verify
 * that the user belongs to the master billing tenant.
 *
 * For internal ext-proxy prefetch requests, we trust the user info passed in headers
 * since ext-proxy already validated the session before making the internal request.
 */
async function assertMasterTenantAccess(request: NextRequest): Promise<{ tenantId: string; userId?: string; userEmail?: string }> {
  if (!MASTER_BILLING_TENANT_ID) {
    throw new Error('MASTER_BILLING_TENANT_ID not configured on server');
  }

  // Check for internal ext-proxy request with trusted user info
  const internalUser = getInternalUserInfo(request);
  if (internalUser) {
    if (internalUser.tenant !== MASTER_BILLING_TENANT_ID) {
      throw new Error('Access denied: Platform reports require master tenant access');
    }
    return {
      tenantId: MASTER_BILLING_TENANT_ID,
      userId: internalUser.user_id,
      userEmail: internalUser.email,
    };
  }

  // For external requests, validate the user session
  const user = await getCurrentUser();

  if (!user) {
    throw new Error('Authentication required');
  }

  if (user.tenant !== MASTER_BILLING_TENANT_ID) {
    throw new Error('Access denied: Platform reports require master tenant access');
  }

  return {
    tenantId: MASTER_BILLING_TENANT_ID,
    userId: user.user_id,
    userEmail: user.email,
  };
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
    const { tenantId: masterTenantId, userId, userEmail } = await assertMasterTenantAccess(request);
    const { reportId } = await context.params;

    const service = new PlatformReportService(masterTenantId);
    const auditService = new PlatformReportAuditService(masterTenantId);
    const report = await service.getReport(reportId);

    if (!report) {
      return NextResponse.json(
        { success: false, error: 'Report not found' },
        { status: 404 }
      );
    }

    // Log the view action
    const clientInfo = extractClientInfo(request);
    await auditService.logEvent({
      eventType: 'report.view',
      userId,
      userEmail,
      resourceType: 'report',
      resourceId: report.report_id,
      resourceName: report.name,
      ...clientInfo,
    });

    return NextResponse.json({ success: true, data: report });
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
    const { tenantId: masterTenantId, userId, userEmail } = await assertMasterTenantAccess(request);
    const { reportId } = await context.params;

    const service = new PlatformReportService(masterTenantId);
    const auditService = new PlatformReportAuditService(masterTenantId);
    const body = await request.json() as UpdateReportInput;

    const report = await service.updateReport(reportId, body);

    if (!report) {
      return NextResponse.json(
        { success: false, error: 'Report not found' },
        { status: 404 }
      );
    }

    // Log the update action
    const clientInfo = extractClientInfo(request);
    await auditService.logEvent({
      eventType: 'report.update',
      userId,
      userEmail,
      resourceType: 'report',
      resourceId: report.report_id,
      resourceName: report.name,
      details: { updatedFields: Object.keys(body) },
      ...clientInfo,
    });

    return NextResponse.json({ success: true, data: report });
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

      // Report permission errors (blocklist violations)
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
    const { tenantId: masterTenantId, userId, userEmail } = await assertMasterTenantAccess(request);
    const { reportId } = await context.params;

    const service = new PlatformReportService(masterTenantId);
    const auditService = new PlatformReportAuditService(masterTenantId);

    // Get report name before deletion for logging
    const report = await service.getReport(reportId);

    const deleted = await service.deleteReport(reportId);

    if (!deleted) {
      return NextResponse.json(
        { success: false, error: 'Report not found' },
        { status: 404 }
      );
    }

    // Log the delete action
    const clientInfo = extractClientInfo(request);
    await auditService.logEvent({
      eventType: 'report.delete',
      userId,
      userEmail,
      resourceType: 'report',
      resourceId: reportId,
      resourceName: report?.name,
      ...clientInfo,
    });

    return NextResponse.json({ success: true, message: 'Report deleted' });
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
