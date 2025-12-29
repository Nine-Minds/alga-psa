/**
 * Platform Reports API - Execute Report endpoint
 *
 * POST /api/v1/platform-reports/:reportId/execute - Execute a platform report
 *
 * Access restricted to users from MASTER_BILLING_TENANT_ID only.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/actions/user-actions/userActions';
import { ApiKeyServiceForApi } from '@/lib/services/apiKeyServiceForApi';
import {
  PlatformReportService,
  PlatformReportAuditService,
  extractClientInfo,
} from '@ee/lib/platformReports';
import { ReportParameters } from 'server/src/lib/reports/core/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MASTER_BILLING_TENANT_ID = process.env.MASTER_BILLING_TENANT_ID;

/**
 * Verify the caller has access to platform reports.
 * Supports both API key auth and session auth.
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
    console.warn('[platform-reports/execute] Invalid API key');
  }

  // SESSION AUTH
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
 * POST /api/v1/platform-reports/:reportId/execute
 * Execute a platform report and return results
 */
export async function POST(
  request: NextRequest,
  context: RouteContext
): Promise<NextResponse> {
  try {
    const { tenantId: masterTenantId, userId, userEmail } = await assertMasterTenantAccess(request);
    const { reportId } = await context.params;

    const service = new PlatformReportService(masterTenantId);
    const auditService = new PlatformReportAuditService(masterTenantId);

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

    // Log the execute action
    const clientInfo = extractClientInfo(request);
    await auditService.logEvent({
      eventType: 'report.execute',
      userId,
      userEmail,
      resourceType: 'report',
      resourceId: reportId,
      resourceName: result.reportName,
      details: {
        parameters,
        executionTime: result.metadata?.executionTime,
        metricsCount: Object.keys(result.metrics || {}).length,
      },
      ...clientInfo,
    });

    return NextResponse.json({ success: true, data: result });
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

      // Report permission errors (blocklist violations)
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
