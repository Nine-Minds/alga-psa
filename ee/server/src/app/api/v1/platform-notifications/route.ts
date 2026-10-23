/**
 * Platform Notifications API - List and Create endpoints
 *
 * GET  /api/v1/platform-notifications - List all platform notifications
 * POST /api/v1/platform-notifications - Create a new platform notification
 *
 * Access restricted to users from MASTER_BILLING_TENANT_ID only.
 */

import { NextRequest, NextResponse } from 'next/server';
import { PlatformNotificationService, CreateNotificationInput } from '@ee/lib/platformNotifications';
import { PlatformReportAuditService, extractClientInfo } from '@ee/lib/platformReports';
import { assertMasterTenantAccess } from '@ee/lib/auth/masterTenantAccess';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MASTER_BILLING_TENANT_ID = process.env.MASTER_BILLING_TENANT_ID;

/**
 * GET /api/v1/platform-notifications
 * List all platform notifications
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const { tenantId: masterTenantId, userId, userEmail } = await assertMasterTenantAccess(request);

    const service = new PlatformNotificationService(masterTenantId);
    const auditService = new PlatformReportAuditService(masterTenantId);

    // Parse query params
    const { searchParams } = new URL(request.url);
    const activeOnly = searchParams.get('activeOnly') !== 'false';

    const notifications = await service.listNotifications({ activeOnly });

    // Log the list action
    const clientInfo = extractClientInfo(request);
    await auditService.logEvent({
      eventType: 'notification.list',
      userId,
      userEmail,
      details: { activeOnly, count: notifications.length },
      ...clientInfo,
    });

    return NextResponse.json({ success: true, data: notifications });
  } catch (error) {
    console.error('[platform-notifications] GET error:', error);

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

/**
 * POST /api/v1/platform-notifications
 * Create a new platform notification
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const { tenantId: masterTenantId, userId, userEmail } = await assertMasterTenantAccess(request);

    const service = new PlatformNotificationService(masterTenantId);
    const auditService = new PlatformReportAuditService(masterTenantId);

    const body = await request.json() as CreateNotificationInput;

    // Validate required fields
    if (!body.title || typeof body.title !== 'string') {
      return NextResponse.json(
        { success: false, error: 'title is required' },
        { status: 400 }
      );
    }

    if (!body.banner_content || typeof body.banner_content !== 'string') {
      return NextResponse.json(
        { success: false, error: 'banner_content is required' },
        { status: 400 }
      );
    }

    if (!body.detail_content || typeof body.detail_content !== 'string') {
      return NextResponse.json(
        { success: false, error: 'detail_content is required' },
        { status: 400 }
      );
    }

    const notification = await service.createNotification(body, userId);

    // Log the create action
    const clientInfo = extractClientInfo(request);
    await auditService.logEvent({
      eventType: 'notification.create',
      userId,
      userEmail,
      resourceType: 'notification',
      resourceId: notification.notification_id,
      resourceName: notification.title,
      ...clientInfo,
    });

    return NextResponse.json({ success: true, data: notification }, { status: 201 });
  } catch (error) {
    console.error('[platform-notifications] POST error:', error);

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
