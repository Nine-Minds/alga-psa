/**
 * Platform Notifications API - Notification Stats endpoint
 *
 * GET /api/v1/platform-notifications/:notificationId/stats - Get read/dismiss stats
 *
 * Access restricted to users from MASTER_BILLING_TENANT_ID only.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@alga-psa/user-composition/actions';
import { ApiKeyServiceForApi } from '@/lib/services/apiKeyServiceForApi';
import { PlatformNotificationService } from '@ee/lib/platformNotifications';
import { PlatformReportAuditService, extractClientInfo } from '@ee/lib/platformReports';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MASTER_BILLING_TENANT_ID = process.env.MASTER_BILLING_TENANT_ID;

/**
 * Verify the caller has access to platform notifications.
 *
 * SECURITY: Platform notifications provide cross-tenant data access, so we MUST verify
 * that the caller has appropriate access via either:
 * 1. API key auth (x-api-key header) - for extension uiProxy calls
 * 2. Session auth - for direct browser calls
 */
async function assertMasterTenantAccess(request: NextRequest): Promise<{ tenantId: string; userId?: string; userEmail?: string }> {
  if (!MASTER_BILLING_TENANT_ID) {
    throw new Error('MASTER_BILLING_TENANT_ID not configured on server');
  }

  // API KEY AUTH: Check for x-api-key header (used by extension uiProxy)
  const apiKey = request.headers.get('x-api-key');
  const extensionId = request.headers.get('x-alga-extension');

  if (apiKey) {
    const keyRecord = await ApiKeyServiceForApi.validateApiKeyAnyTenant(apiKey);
    if (keyRecord) {
      if (keyRecord.tenant === MASTER_BILLING_TENANT_ID) {
        // Get user info from headers (forwarded by runner from ext-proxy)
        const headerUserId = request.headers.get('x-user-id');
        const headerUserEmail = request.headers.get('x-user-email');

        return {
          tenantId: MASTER_BILLING_TENANT_ID,
          userId: headerUserId || (extensionId ? `extension:${extensionId}` : keyRecord.user_id),
          userEmail: headerUserEmail || undefined,
        };
      }
      throw new Error('Access denied: API key not authorized for platform notifications');
    }
    console.warn('[platform-notifications/:id/stats] Invalid API key');
  }

  // SESSION AUTH: Fall back to browser session-based authentication
  const user = await getCurrentUser();

  if (!user) {
    throw new Error('Authentication required');
  }

  if (user.tenant !== MASTER_BILLING_TENANT_ID) {
    throw new Error('Access denied: Platform notifications require master tenant access');
  }

  return {
    tenantId: MASTER_BILLING_TENANT_ID,
    userId: user.user_id,
    userEmail: user.email,
  };
}

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
