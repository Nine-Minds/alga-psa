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
import { getCurrentUser } from '@alga-psa/users/actions';
import { ApiKeyServiceForApi } from '@/lib/services/apiKeyServiceForApi';
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
 * Verify the caller has access to platform reports.
 *
 * SECURITY: Platform reports provide cross-tenant data access, so we MUST verify
 * that the caller has appropriate access via either:
 * 1. API key auth (x-api-key header) - for extension uiProxy calls
 * 2. Session auth - for direct browser calls
 */
async function assertMasterTenantAccess(request: NextRequest): Promise<{ tenantId: string; userId?: string; userEmail?: string }> {
  if (!MASTER_BILLING_TENANT_ID) {
    throw new Error('MASTER_BILLING_TENANT_ID not configured on server');
  }

  // API KEY AUTH: Check for x-api-key header (used by extension uiProxy)
  const apiKey = request.headers.get('x-api-key');
  const extensionId = request.headers.get('x-alga-extension');

  if (apiKey) {
    const keyRecord = await ApiKeyServiceForApi.validateApiKeyAnyTenant(apiKey);
    if (keyRecord) {
      if (keyRecord.tenant === MASTER_BILLING_TENANT_ID) {
        // Get user info from headers (forwarded by runner from ext-proxy)
        const headerUserId = request.headers.get('x-user-id');
        const headerUserEmail = request.headers.get('x-user-email');

        return {
          tenantId: MASTER_BILLING_TENANT_ID,
          userId: headerUserId || (extensionId ? `extension:${extensionId}` : keyRecord.user_id),
          userEmail: headerUserEmail || undefined,
        };
      }
      throw new Error('Access denied: API key not authorized for platform reports');
    }
    console.warn('[platform-reports/:id] Invalid API key');
  }

  // SESSION AUTH: Fall back to browser session-based authentication
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
 * Internal handler for PUT logic - can be called from PUT or POST with __method override
 */
async function handlePut(
  request: NextRequest,
  context: RouteContext,
  body?: UpdateReportInput
): Promise<NextResponse> {
  try {
    const { tenantId: masterTenantId, userId, userEmail } = await assertMasterTenantAccess(request);
    const { reportId } = await context.params;

    const service = new PlatformReportService(masterTenantId);
    const auditService = new PlatformReportAuditService(masterTenantId);
    const updateData = body ?? await request.json() as UpdateReportInput;

    const report = await service.updateReport(reportId, updateData);

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
      details: { updatedFields: Object.keys(updateData) },
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
 * PUT /api/v1/platform-reports/:reportId
 * Update a platform report
 */
export async function PUT(
  request: NextRequest,
  context: RouteContext
): Promise<NextResponse> {
  return handlePut(request, context);
}

/**
 * POST /api/v1/platform-reports/:reportId
 * Handle method override for uiProxy calls (which only support GET/POST)
 *
 * The extension's uiProxy can only send GET (no body) or POST (with body).
 * To support PUT/DELETE operations, we check for __method in the body:
 * - { __method: 'PUT', ...data } -> routes to PUT handler
 * - { __method: 'DELETE' } -> routes to DELETE handler
 */
export async function POST(
  request: NextRequest,
  context: RouteContext
): Promise<NextResponse> {
  try {
    const body = await request.json();
    const method = body.__method?.toUpperCase();

    if (method === 'PUT') {
      // Remove __method from body before passing to update logic
      const { __method, ...updateData } = body;
      return handlePut(request, context, updateData);
    }

    if (method === 'DELETE') {
      return handleDelete(request, context);
    }

    // No __method specified - treat as invalid request
    return NextResponse.json(
      { success: false, error: 'POST not supported. Use __method: "PUT" or __method: "DELETE"' },
      { status: 405 }
    );
  } catch (error) {
    console.error('[platform-reports/:id] POST error:', error);
    return NextResponse.json(
      { success: false, error: 'Invalid request body' },
      { status: 400 }
    );
  }
}

/**
 * Internal handler for DELETE logic - can be called from DELETE or POST with __method override
 */
async function handleDelete(
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

/**
 * DELETE /api/v1/platform-reports/:reportId
 * Delete a platform report (soft delete)
 */
export async function DELETE(
  request: NextRequest,
  context: RouteContext
): Promise<NextResponse> {
  return handleDelete(request, context);
}
