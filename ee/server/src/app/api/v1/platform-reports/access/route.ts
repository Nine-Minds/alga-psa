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

    // Check for internal ext-proxy request with trusted user info
    const internalUser = getInternalUserInfo(request);
    let userId: string;
    let userEmail: string;
    let userTenant: string;

    if (internalUser) {
      userId = internalUser.user_id;
      userEmail = internalUser.email;
      userTenant = internalUser.tenant;
    } else {
      const user = await getCurrentUser();

      if (!user) {
        return NextResponse.json(
          { success: false, error: 'Authentication required' },
          { status: 401 }
        );
      }

      userId = user.user_id;
      userEmail = user.email;
      userTenant = user.tenant;
    }

    // Only allow users from master tenant
    if (userTenant !== MASTER_BILLING_TENANT_ID) {
      return NextResponse.json(
        { success: false, error: 'Access denied' },
        { status: 403 }
      );
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
