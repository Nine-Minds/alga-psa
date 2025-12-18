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

/** CORS headers for extension iframe access */
function corsHeaders(request: NextRequest): HeadersInit {
  const origin = request.headers.get('origin') || '*';
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Credentials': 'true',
  };
}

function jsonResponse(data: unknown, init: ResponseInit & { request?: NextRequest } = {}): NextResponse {
  const headers = init.request ? corsHeaders(init.request) : {};
  return NextResponse.json(data, { ...init, headers: { ...headers, ...init.headers } });
}

export async function OPTIONS(request: NextRequest): Promise<NextResponse> {
  return new NextResponse(null, { status: 204, headers: corsHeaders(request) });
}

/**
 * Verify the caller has access to audit logs.
 */
async function assertMasterTenantAccess(): Promise<string> {
  if (!MASTER_BILLING_TENANT_ID) {
    throw new Error('MASTER_BILLING_TENANT_ID not configured on server');
  }

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
    const masterTenantId = await assertMasterTenantAccess();

    const auditService = new PlatformReportAuditService(masterTenantId);

    // Get query parameters for filtering
    const { searchParams } = new URL(request.url);
    const eventType = searchParams.get('eventType') as AuditEventType | null;
    const userId = searchParams.get('userId') || undefined;
    const reportId = searchParams.get('reportId') || undefined;
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');
    const limit = searchParams.get('limit');
    const offset = searchParams.get('offset');

    // Check if stats are requested
    if (searchParams.get('stats') === 'true') {
      const stats = await auditService.getStats();
      return jsonResponse({
        success: true,
        data: stats,
      }, { request });
    }

    const logs = await auditService.listLogs({
      eventType: eventType || undefined,
      userId,
      reportId,
      startDate: startDate ? new Date(startDate) : undefined,
      endDate: endDate ? new Date(endDate) : undefined,
      limit: limit ? parseInt(limit, 10) : 100,
      offset: offset ? parseInt(offset, 10) : 0,
    });

    return jsonResponse({
      success: true,
      data: logs,
    }, { request });
  } catch (error) {
    console.error('[platform-reports/audit] GET error:', error);

    if (error instanceof Error) {
      if (
        error.message.includes('Access denied') ||
        error.message.includes('Authentication')
      ) {
        return jsonResponse(
          { success: false, error: error.message },
          { status: 403, request }
        );
      }
    }

    return jsonResponse(
      { success: false, error: 'Internal server error' },
      { status: 500, request }
    );
  }
}
