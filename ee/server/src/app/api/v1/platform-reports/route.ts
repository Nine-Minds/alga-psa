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
 * Verify the caller has access to platform reports.
 *
 * SECURITY: Platform reports provide cross-tenant data access, so we MUST verify
 * that the caller has appropriate access via either:
 * 1. Runner service auth (x-runner-auth header) - for extension uiProxy calls
 * 2. Session auth - for direct browser calls
 *
 * Returns the tenant ID to use for queries and user info.
 */
async function assertMasterTenantAccess(request: NextRequest): Promise<{ tenantId: string; userId?: string; userEmail?: string }> {
  if (!MASTER_BILLING_TENANT_ID) {
    throw new Error('MASTER_BILLING_TENANT_ID not configured on server');
  }

  // ─────────────────────────────────────────────────────────────────
  // RUNNER SERVICE AUTH: Check if this is a call from the extension runner
  // ─────────────────────────────────────────────────────────────────
  const runnerAuth = request.headers.get('x-runner-auth');
  const runnerTenant = request.headers.get('x-alga-tenant');
  const extensionId = request.headers.get('x-alga-extension');

  if (runnerAuth && runnerTenant) {
    // Validate the runner service token
    const expectedToken = process.env.RUNNER_SERVICE_TOKEN || process.env.UI_PROXY_AUTH_KEY;
    if (expectedToken && runnerAuth === expectedToken) {
      // Verify the extension is calling on behalf of master tenant
      if (runnerTenant === MASTER_BILLING_TENANT_ID) {
        console.log('[platform-reports] Runner auth accepted:', { extensionId, tenant: runnerTenant });
        return {
          tenantId: MASTER_BILLING_TENANT_ID,
          userId: extensionId ? `extension:${extensionId}` : 'runner',
          userEmail: undefined,
        };
      }
      throw new Error('Access denied: Extension not authorized for platform reports');
    }
    // Invalid token - fall through to session auth (or reject)
    console.warn('[platform-reports] Invalid runner auth token');
  }

  // ─────────────────────────────────────────────────────────────────
  // SESSION AUTH: Fall back to browser session-based authentication
  // ─────────────────────────────────────────────────────────────────
  const user = await getCurrentUser();

  if (!user) {
    throw new Error('Authentication required');
  }

  // User MUST be from the master billing tenant to access cross-tenant reports
  if (user.tenant !== MASTER_BILLING_TENANT_ID) {
    throw new Error('Access denied: Platform reports require master tenant access');
  }

  // Log extension context if present (for debugging, but don't trust it for auth)
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
