/**
 * Platform Notifications API - Notification Stats endpoint
 *
 * GET /api/v1/platform-notifications/:notificationId/stats - Get read/dismiss stats
 *
 * Access restricted to users from MASTER_BILLING_TENANT_ID only.
 */

import { NextRequest, NextResponse } from 'next/server';
import { PlatformNotificationService } from '@ee/lib/platformNotifications';
import { PlatformReportAuditService, extractClientInfo } from '@ee/lib/platformReports';
import { assertMasterTenantAccess } from '@ee/lib/auth/masterTenantAccess';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MASTER_BILLING_TENANT_ID = process.env.MASTER_BILLING_TENANT_ID;

interface RouteContext {
  params: Promise<{ notificationId: string }>;
}

/**
 * GET /api/v1/platform-notifications/:notificationId/stats
 * Get read/dismiss stats for a notification
 */
export async function GET(
  request: NextRequest,
  context: RouteContext
): Promise<NextResponse> {
  try {
    const { tenantId: masterTenantId, userId, userEmail } = await assertMasterTenantAccess(request);
    const { notificationId } = await context.params;

    const service = new PlatformNotificationService(masterTenantId);
    const auditService = new PlatformReportAuditService(masterTenantId);

    const stats = await service.getNotificationStats(notificationId);

    // Log the stats action
    const clientInfo = extractClientInfo(request);
    await auditService.logEvent({
      eventType: 'notification.stats',
      userId,
      userEmail,
      resourceType: 'notification',
      resourceId: notificationId,
      ...clientInfo,
    });

    return NextResponse.json({ success: true, data: stats });
  } catch (error) {
    console.error('[platform-notifications/:id/stats] GET error:', error);

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
