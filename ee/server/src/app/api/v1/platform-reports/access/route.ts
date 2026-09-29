/**
 * Platform Reports Access Logging API
 *
 * POST /api/v1/platform-reports/access - Log extension access
 *
 * This endpoint is called when the extension iframe is first loaded
 * to track who is accessing the platform reports extension.
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  PlatformReportAuditService,
  extractClientInfo,
} from '@ee/lib/platformReports';
import { assertMasterTenantAccess, isMasterTenantAuthError } from '@ee/lib/auth/masterTenantAccess';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MASTER_BILLING_TENANT_ID = process.env.MASTER_BILLING_TENANT_ID;

/**
 * POST /api/v1/platform-reports/access
 * Log that a user accessed the extension
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    if (!MASTER_BILLING_TENANT_ID) {
      return NextResponse.json(
        { success: false, error: 'MASTER_BILLING_TENANT_ID not configured' },
        { status: 500 }
      );
    }

    const { userId, userEmail } = await assertMasterTenantAccess(request);

    const auditService = new PlatformReportAuditService(MASTER_BILLING_TENANT_ID);
    const clientInfo = extractClientInfo(request);

    // Get optional details from request body
    let details: Record<string, unknown> = {};
    try {
      const body = await request.json();
      details = body.details || {};
    } catch {
      // No body or invalid JSON - that's fine
    }

    await auditService.logEvent({
      eventType: 'extension.access',
      userId,
      userEmail,
      details: {
        ...details,
        accessedAt: new Date().toISOString(),
      },
      ...clientInfo,
    });

    return NextResponse.json({ success: true, message: 'Access logged' });
  } catch (error) {
    if (isMasterTenantAuthError(error)) {
      return NextResponse.json({ success: false, error: 'Access denied' }, { status: 403 });
    }
    console.error('[platform-reports/access] POST error:', error);

    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
