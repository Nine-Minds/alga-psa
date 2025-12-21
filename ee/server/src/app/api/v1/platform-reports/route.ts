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
 * Internal requests include x-internal-request header and user info headers.
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
 * that the user belongs to the master billing tenant. We cannot trust headers alone
 * as they can be spoofed by malicious clients.
 *
 * For internal ext-proxy prefetch requests, we trust the user info passed in headers
 * since ext-proxy already validated the session before making the internal request.
 *
 * Returns the tenant ID to use for queries and user info.
 */
async function assertMasterTenantAccess(request: NextRequest): Promise<{ tenantId: string; userId?: string; userEmail?: string }> {
  if (!MASTER_BILLING_TENANT_ID) {
    throw new Error('MASTER_BILLING_TENANT_ID not configured on server');
  }

  // Check for internal ext-proxy request with trusted user info
  const internalUser = getInternalUserInfo(request);
  if (internalUser) {
    console.log('[platform-reports] Internal ext-proxy request:', {
      userId: internalUser.user_id,
      tenant: internalUser.tenant,
    });

    // Verify the internal user is from master tenant
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

  return {
    tenantId: MASTER_BILLING_TENANT_ID,
    userId: user.user_id,
    userEmail: user.email,
  };
}

/**
 * GET /api/v1/platform-reports
 * List all platform reports
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const { tenantId: masterTenantId, userId, userEmail } = await assertMasterTenantAccess(request);

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
      userId,
      userEmail,
      details: { category, activeOnly, count: reports.length },
      ...clientInfo,
    });

    return NextResponse.json({ success: true, data: reports });
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
    const { tenantId: masterTenantId, userId, userEmail } = await assertMasterTenantAccess(request);

    const service = new PlatformReportService(masterTenantId);
    const auditService = new PlatformReportAuditService(masterTenantId);

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

    const report = await service.createReport(body, userId);

    // Log the create action
    const clientInfo = extractClientInfo(request);
    await auditService.logEvent({
      eventType: 'report.create',
      userId,
      userEmail,
      resourceType: 'report',
      resourceId: report.report_id,
      resourceName: report.name,
      details: { category: report.category },
      ...clientInfo,
    });

    return NextResponse.json({ success: true, data: report }, { status: 201 });
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
