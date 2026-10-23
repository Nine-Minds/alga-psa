/**
 * Platform Reports API - List and Create endpoints
 *
 * GET  /api/v1/platform-reports - List all platform reports
 * POST /api/v1/platform-reports - Create a new platform report
 *
 * Access restricted to users from MASTER_BILLING_TENANT_ID only.
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  PlatformReportService,
  CreateReportInput,
  PlatformReportAuditService,
  extractClientInfo,
} from '@ee/lib/platformReports';
import { assertMasterTenantAccess } from '@ee/lib/auth/masterTenantAccess';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MASTER_BILLING_TENANT_ID = process.env.MASTER_BILLING_TENANT_ID;

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
          { success: false, error: 'Access denied to platform reports.' },
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
          { success: false, error: 'Access denied to platform reports.' },
          { status: 403 }
        );
      }

      // Report permission errors (blocklist violations)
      if (error.name === 'ReportPermissionError') {
        return NextResponse.json(
          { success: false, error: 'Report creation was blocked by the report security policy.' },
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
