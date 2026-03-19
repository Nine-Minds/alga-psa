/**
 * Platform Notifications API - Single Notification endpoints
 *
 * GET    /api/v1/platform-notifications/:notificationId - Get a single notification
 * PUT    /api/v1/platform-notifications/:notificationId - Update a notification
 * DELETE /api/v1/platform-notifications/:notificationId - Delete a notification (soft delete)
 *
 * Access restricted to users from MASTER_BILLING_TENANT_ID only.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@alga-psa/user-composition/actions';
import { ApiKeyServiceForApi } from '@/lib/services/apiKeyServiceForApi';
import { PlatformNotificationService, UpdateNotificationInput } from '@ee/lib/platformNotifications';
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
    console.warn('[platform-notifications/:id] Invalid API key');
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
 * GET /api/v1/platform-notifications/:notificationId
 * Get a single platform notification
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
    const notification = await service.getNotification(notificationId);

    if (!notification) {
      return NextResponse.json(
        { success: false, error: 'Notification not found' },
        { status: 404 }
      );
    }

    // Log the view action
    const clientInfo = extractClientInfo(request);
    await auditService.logEvent({
      eventType: 'notification.view',
      userId,
      userEmail,
      resourceType: 'notification',
      resourceId: notification.notification_id,
      resourceName: notification.title,
      ...clientInfo,
    });

    return NextResponse.json({ success: true, data: notification });
  } catch (error) {
    console.error('[platform-notifications/:id] GET error:', error);

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
 * Internal handler for PUT logic - can be called from PUT or POST with __method override
 */
async function handlePut(
  request: NextRequest,
  context: RouteContext,
  body?: UpdateNotificationInput
): Promise<NextResponse> {
  try {
    const { tenantId: masterTenantId, userId, userEmail } = await assertMasterTenantAccess(request);
    const { notificationId } = await context.params;

    const service = new PlatformNotificationService(masterTenantId);
    const auditService = new PlatformReportAuditService(masterTenantId);
    const updateData = body ?? await request.json() as UpdateNotificationInput;

    const notification = await service.updateNotification(notificationId, updateData);

    if (!notification) {
      return NextResponse.json(
        { success: false, error: 'Notification not found' },
        { status: 404 }
      );
    }

    // Log the update action
    const clientInfo = extractClientInfo(request);
    await auditService.logEvent({
      eventType: 'notification.update',
      userId,
      userEmail,
      resourceType: 'notification',
      resourceId: notification.notification_id,
      resourceName: notification.title,
      details: { updatedFields: Object.keys(updateData) },
      ...clientInfo,
    });

    return NextResponse.json({ success: true, data: notification });
  } catch (error) {
    console.error('[platform-notifications/:id] PUT error:', error);

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
 * PUT /api/v1/platform-notifications/:notificationId
 * Update a platform notification
 */
export async function PUT(
  request: NextRequest,
  context: RouteContext
): Promise<NextResponse> {
  return handlePut(request, context);
}

/**
 * POST /api/v1/platform-notifications/:notificationId
 * Handle method override for uiProxy calls (which only support GET/POST)
 *
 * The extension's uiProxy can only send GET (no body) or POST (with body).
 * To support PUT/DELETE operations, we check for __method in the body:
 * - { __method: 'PUT', ...data } -> routes to PUT handler
 * - { __method: 'DELETE' } -> routes to DELETE handler
 */
export async function POST(
  request: NextRequest,
  context: RouteContext
): Promise<NextResponse> {
  try {
    const body = await request.json();
    const method = body.__method?.toUpperCase();

    if (method === 'PUT') {
      // Remove __method from body before passing to update logic
      const { __method, ...updateData } = body;
      return handlePut(request, context, updateData);
    }

    if (method === 'DELETE') {
      return handleDelete(request, context);
    }

    // No __method specified - treat as invalid request
    return NextResponse.json(
      { success: false, error: 'POST not supported. Use __method: "PUT" or __method: "DELETE"' },
      { status: 405 }
    );
  } catch (error) {
    console.error('[platform-notifications/:id] POST error:', error);
    return NextResponse.json(
      { success: false, error: 'Invalid request body' },
      { status: 400 }
    );
  }
}

/**
 * Internal handler for DELETE logic - can be called from DELETE or POST with __method override
 */
async function handleDelete(
  request: NextRequest,
  context: RouteContext
): Promise<NextResponse> {
  try {
    const { tenantId: masterTenantId, userId, userEmail } = await assertMasterTenantAccess(request);
    const { notificationId } = await context.params;

    const service = new PlatformNotificationService(masterTenantId);
    const auditService = new PlatformReportAuditService(masterTenantId);

    // Get notification name before deletion for logging
    const notification = await service.getNotification(notificationId);

    const deleted = await service.deleteNotification(notificationId);

    if (!deleted) {
      return NextResponse.json(
        { success: false, error: 'Notification not found' },
        { status: 404 }
      );
    }

    // Log the delete action
    const clientInfo = extractClientInfo(request);
    await auditService.logEvent({
      eventType: 'notification.delete',
      userId,
      userEmail,
      resourceType: 'notification',
      resourceId: notificationId,
      resourceName: notification?.title,
      ...clientInfo,
    });

    return NextResponse.json({ success: true, message: 'Notification deleted' });
  } catch (error) {
    console.error('[platform-notifications/:id] DELETE error:', error);

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
 * DELETE /api/v1/platform-notifications/:notificationId
 * Delete a platform notification (soft delete)
 */
export async function DELETE(
  request: NextRequest,
  context: RouteContext
): Promise<NextResponse> {
  return handleDelete(request, context);
}
