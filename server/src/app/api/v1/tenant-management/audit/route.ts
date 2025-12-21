import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/actions/user-actions/userActions';
import { PlatformReportAuditService } from '@ee/lib/platformReports';

const MASTER_BILLING_TENANT_ID = process.env.MASTER_BILLING_TENANT_ID;

/**
 * Check if this is an internal request from ext-proxy with trusted user info.
 */
function getInternalUserInfo(request: NextRequest): { user_id: string; tenant: string } | null {
  const internalRequest = request.headers.get('x-internal-request');
  if (internalRequest !== 'ext-proxy-prefetch') {
    return null;
  }

  const userId = request.headers.get('x-internal-user-id');
  const tenant = request.headers.get('x-internal-user-tenant');

  if (!userId || !tenant) {
    return null;
  }

  return { user_id: userId, tenant };
}

export async function GET(req: NextRequest) {
  try {
    // Check for internal ext-proxy request first
    const internalUser = getInternalUserInfo(req);
    let userTenant: string;

    if (internalUser) {
      // Trust the user info from ext-proxy (it already validated the session)
      userTenant = internalUser.tenant;
    } else {
      // Normal request - get user from session
      const user = await getCurrentUser();

      if (!user) {
        return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
      }

      userTenant = user.tenant;
    }

    if (userTenant !== MASTER_BILLING_TENANT_ID) {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const eventType = searchParams.get('eventType') as any || undefined;
    const eventTypePrefix = searchParams.get('eventTypePrefix') || undefined;  // e.g., 'tenant.' for all tenant events
    const resourceType = searchParams.get('resourceType') as any || undefined;
    const limit = parseInt(searchParams.get('limit') || '100', 10);

    const auditService = new PlatformReportAuditService(MASTER_BILLING_TENANT_ID!);
    const logs = await auditService.listLogs({
      eventType,
      eventTypePrefix,
      resourceType,
      limit,
    });

    return NextResponse.json({ success: true, data: logs });
  } catch (error) {
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }, { status: 500 });
  }
}
