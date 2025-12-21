/**
 * Platform Reports Audit API - Fetch audit logs
 *
 * GET /api/v1/platform-reports/audit - List audit logs with optional filters
 * GET /api/v1/platform-reports/audit/stats - Get audit statistics
 *
 * Access restricted to users from MASTER_BILLING_TENANT_ID only.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/actions/user-actions/userActions';
import {
  PlatformReportAuditService,
  AuditEventType,
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
 * Verify the caller has access to audit logs.
 */
async function assertMasterTenantAccess(request: NextRequest): Promise<string> {
  if (!MASTER_BILLING_TENANT_ID) {
    throw new Error('MASTER_BILLING_TENANT_ID not configured on server');
  }

  // Check for internal ext-proxy request with trusted user info
  const internalUser = getInternalUserInfo(request);
  if (internalUser) {
    if (internalUser.tenant !== MASTER_BILLING_TENANT_ID) {
      throw new Error('Access denied: Audit logs require master tenant access');
    }
    return MASTER_BILLING_TENANT_ID;
  }

  // For external requests, validate the user session
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
