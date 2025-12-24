/**
 * Platform Reports Access Logging API
 *
 * POST /api/v1/platform-reports/access - Log extension access
 *
 * This endpoint is called when the extension iframe is first loaded
 * to track who is accessing the platform reports extension.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/actions/user-actions/userActions';
import {
  PlatformReportAuditService,
  extractClientInfo,
} from '@ee/lib/platformReports';

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

    // RUNNER SERVICE AUTH
    const runnerAuth = request.headers.get('x-runner-auth');
    const runnerTenant = request.headers.get('x-alga-tenant');
    const extensionId = request.headers.get('x-alga-extension');
    let userId: string | undefined;
    let userEmail: string | undefined;

    if (runnerAuth && runnerTenant) {
      const expectedToken = process.env.RUNNER_SERVICE_TOKEN || process.env.UI_PROXY_AUTH_KEY;
      if (expectedToken && runnerAuth === expectedToken) {
        if (runnerTenant !== MASTER_BILLING_TENANT_ID) {
          return NextResponse.json(
            { success: false, error: 'Access denied' },
            { status: 403 }
          );
        }
        userId = extensionId ? `extension:${extensionId}` : 'runner';
      } else {
        console.warn('[platform-reports/access] Invalid runner auth token');
      }
    }

    // SESSION AUTH if runner auth didn't succeed
    if (!userId) {
      const user = await getCurrentUser();

      if (!user) {
        return NextResponse.json(
          { success: false, error: 'Authentication required' },
          { status: 401 }
        );
      }

      if (user.tenant !== MASTER_BILLING_TENANT_ID) {
        return NextResponse.json(
          { success: false, error: 'Access denied' },
          { status: 403 }
        );
      }

      userId = user.user_id;
      userEmail = user.email;
    }

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
    console.error('[platform-reports/access] POST error:', error);

    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
