/**
 * Platform Notifications API - List and Create endpoints
 *
 * GET  /api/v1/platform-notifications - List all platform notifications
 * POST /api/v1/platform-notifications - Create a new platform notification
 *
 * Access restricted to users from MASTER_BILLING_TENANT_ID only.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@alga-psa/user-composition/actions';
import { ApiKeyServiceForApi } from '@/lib/services/apiKeyServiceForApi';
import { PlatformNotificationService, CreateNotificationInput } from '@ee/lib/platformNotifications';
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
 *
 * Returns the tenant ID to use for queries and user info.
 */
async function assertMasterTenantAccess(request: NextRequest): Promise<{ tenantId: string; userId?: string; userEmail?: string }> {
  if (!MASTER_BILLING_TENANT_ID) {
    throw new Error('MASTER_BILLING_TENANT_ID not configured on server');
  }

  const extensionId = request.headers.get('x-alga-extension');

  // ─────────────────────────────────────────────────────────────────
  // API KEY AUTH: Check for x-api-key header (used by extension uiProxy)
  // ─────────────────────────────────────────────────────────────────
  const apiKey = request.headers.get('x-api-key');

  if (apiKey) {
    // Validate the API key using ApiKeyService
    const keyRecord = await ApiKeyServiceForApi.validateApiKeyAnyTenant(apiKey);

    if (keyRecord) {
      // Verify the API key belongs to the master tenant
      if (keyRecord.tenant === MASTER_BILLING_TENANT_ID) {
        // Get user info from headers (forwarded by runner from ext-proxy)
        const headerUserId = request.headers.get('x-user-id');
        const headerUserEmail = request.headers.get('x-user-email');

        // Use header user info if available, otherwise fall back to extension ID or API key owner
        const userId = headerUserId || (extensionId ? `extension:${extensionId}` : keyRecord.user_id);
        const userEmail = headerUserEmail || undefined;

        console.log('[platform-notifications] API key auth accepted:', {
          extensionId,
          tenant: keyRecord.tenant,
          userId,
          userEmail,
        });
        return {
          tenantId: MASTER_BILLING_TENANT_ID,
          userId,
          userEmail,
        };
      }
      throw new Error('Access denied: API key not authorized for platform notifications');
    }
    // Invalid API key - fall through to session auth
    console.warn('[platform-notifications] Invalid API key');
  }

  // ─────────────────────────────────────────────────────────────────
  // SESSION AUTH: Fall back to browser session-based authentication
  // ─────────────────────────────────────────────────────────────────
  const user = await getCurrentUser();

  if (!user) {
    throw new Error('Authentication required');
  }

  // User MUST be from the master billing tenant to access cross-tenant notifications
  if (user.tenant !== MASTER_BILLING_TENANT_ID) {
    throw new Error('Access denied: Platform notifications require master tenant access');
  }

  // Log extension context if present (for debugging, but don't trust it for auth)
  if (extensionId) {
    console.log('[platform-notifications] Extension call from master tenant:', {
      extensionId,
      userId: user.user_id,
    });
  }

  return {
    tenantId: MASTER_BILLING_TENANT_ID,
    userId: user.user_id,
    userEmail: user.email,
  };
}

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
