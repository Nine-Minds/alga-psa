/**
 * Platform Notifications API - Resolve Recipients endpoint
 *
 * POST /api/v1/platform-notifications/resolve-recipients - Resolve matching users for targeting
 *
 * Access restricted to users from MASTER_BILLING_TENANT_ID only.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@alga-psa/user-composition/actions';
import { ApiKeyServiceForApi } from '@/lib/services/apiKeyServiceForApi';
import { PlatformNotificationService, TargetAudienceFilters } from '@ee/lib/platformNotifications';
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
    console.warn('[platform-notifications/resolve-recipients] Invalid API key');
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
