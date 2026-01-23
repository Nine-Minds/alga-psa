/**
 * Platform Reports Audit API - Fetch audit logs
 *
 * GET /api/v1/platform-reports/audit - List audit logs with optional filters
 * GET /api/v1/platform-reports/audit/stats - Get audit statistics
 *
 * Access restricted to users from MASTER_BILLING_TENANT_ID only.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@alga-psa/users/actions';
import { ApiKeyServiceForApi } from '@/lib/services/apiKeyServiceForApi';
import {
  PlatformReportAuditService,
  AuditEventType,
} from '@ee/lib/platformReports';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MASTER_BILLING_TENANT_ID = process.env.MASTER_BILLING_TENANT_ID;

/**
 * Verify the caller has access to audit logs.
 * Supports both API key auth and session auth.
 */
async function assertMasterTenantAccess(request: NextRequest): Promise<string> {
  if (!MASTER_BILLING_TENANT_ID) {
    throw new Error('MASTER_BILLING_TENANT_ID not configured on server');
  }

  // API KEY AUTH
  const apiKey = request.headers.get('x-api-key');

  if (apiKey) {
    const keyRecord = await ApiKeyServiceForApi.validateApiKeyAnyTenant(apiKey);
    if (keyRecord) {
      if (keyRecord.tenant === MASTER_BILLING_TENANT_ID) {
        return MASTER_BILLING_TENANT_ID; // Auth OK
      }
      throw new Error('Access denied: API key not authorized for audit logs');
    }
    console.warn('[platform-reports/audit] Invalid API key');
  }

  // SESSION AUTH
  const user = await getCurrentUser();

  if (!user) {
    throw new Error('Authentication required');
  }

  if (user.tenant !== MASTER_BILLING_TENANT_ID) {
    throw new Error('Access denied: Audit logs require master tenant access');
  }

  return MASTER_BILLING_TENANT_ID;
}

/**
 * GET /api/v1/platform-reports/audit
 * List audit logs with optional filtering
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const masterTenantId = await assertMasterTenantAccess(request);

    const auditService = new PlatformReportAuditService(masterTenantId);

    // Get query parameters for filtering
    const { searchParams } = new URL(request.url);
    const eventType = searchParams.get('eventType') as AuditEventType | null;
    const userId = searchParams.get('userId') || undefined;
    const resourceType = searchParams.get('resourceType') || undefined;
    const resourceId = searchParams.get('resourceId') || undefined;
    const status = searchParams.get('status') || undefined;
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');
    const limit = searchParams.get('limit');
    const offset = searchParams.get('offset');

    // Check if stats are requested
    if (searchParams.get('stats') === 'true') {
      const stats = await auditService.getStats();
      return NextResponse.json({ success: true, data: stats });
    }

    const logs = await auditService.listLogs({
      eventType: eventType || undefined,
      userId,
      resourceType: resourceType as 'report' | 'tenant' | 'user' | 'subscription' | undefined,
      resourceId,
      status: status as 'pending' | 'completed' | 'failed' | 'running' | undefined,
      startDate: startDate ? new Date(startDate) : undefined,
      endDate: endDate ? new Date(endDate) : undefined,
      limit: limit ? parseInt(limit, 10) : 100,
      offset: offset ? parseInt(offset, 10) : 0,
    });

    return NextResponse.json({ success: true, data: logs });
  } catch (error) {
    console.error('[platform-reports/audit] GET error:', error);

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
