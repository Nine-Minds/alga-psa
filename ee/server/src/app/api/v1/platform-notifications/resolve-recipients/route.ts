/**
 * Platform Notifications API - Resolve Recipients endpoint
 *
 * POST /api/v1/platform-notifications/resolve-recipients - Resolve matching users for targeting
 *
 * Access restricted to users from MASTER_BILLING_TENANT_ID only.
 */

import { NextRequest, NextResponse } from 'next/server';
import { PlatformNotificationService, TargetAudienceFilters } from '@ee/lib/platformNotifications';
import { PlatformReportAuditService, extractClientInfo } from '@ee/lib/platformReports';
import { assertMasterTenantAccess } from '@ee/lib/auth/masterTenantAccess';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MASTER_BILLING_TENANT_ID = process.env.MASTER_BILLING_TENANT_ID;

/**
 * POST /api/v1/platform-notifications/resolve-recipients
 * Resolve matching users for notification targeting
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const { tenantId: masterTenantId, userId, userEmail } = await assertMasterTenantAccess(request);

    const service = new PlatformNotificationService(masterTenantId);
    const auditService = new PlatformReportAuditService(masterTenantId);

    const body = await request.json();
    const filters: TargetAudienceFilters = body.filters || {};
    const emailSearch: string | undefined = body.email_search;

    const recipients = await service.resolveRecipients(filters, emailSearch);

    // Log the resolve action
    const clientInfo = extractClientInfo(request);
    await auditService.logEvent({
      eventType: 'notification.resolve_recipients',
      userId,
      userEmail,
      details: { filters, emailSearch, count: recipients.length },
      ...clientInfo,
    });

    return NextResponse.json({ success: true, data: recipients });
  } catch (error) {
    console.error('[platform-notifications/resolve-recipients] POST error:', error);

    if (error instanceof Error) {
      if (
        error.message.includes('Access denied') ||
        error.message.includes('Authentication')
      ) {
        return NextResponse.json(
          { success: false, error: 'Access denied to platform notifications.' },
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
