/**
 * Platform Notifications API - Per-user read/dismiss details
 *
 * GET /api/v1/platform-notifications/:notificationId/reads - Get per-user interaction data
 *
 * Access restricted to users from MASTER_BILLING_TENANT_ID only.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@alga-psa/user-composition/actions';
import { ApiKeyServiceForApi } from '@/lib/services/apiKeyServiceForApi';
import { PlatformNotificationService } from '@ee/lib/platformNotifications';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MASTER_BILLING_TENANT_ID = process.env.MASTER_BILLING_TENANT_ID;

async function assertMasterTenantAccess(request: NextRequest): Promise<{ tenantId: string; userId?: string; userEmail?: string }> {
  if (!MASTER_BILLING_TENANT_ID) {
    throw new Error('MASTER_BILLING_TENANT_ID not configured on server');
  }

  const apiKey = request.headers.get('x-api-key');
  const extensionId = request.headers.get('x-alga-extension');

  if (apiKey) {
    const keyRecord = await ApiKeyServiceForApi.validateApiKeyAnyTenant(apiKey);
    if (keyRecord) {
      if (keyRecord.tenant === MASTER_BILLING_TENANT_ID) {
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
  }

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
 * GET /api/v1/platform-notifications/:notificationId/reads
 * Get per-user read/dismiss data with timestamps
 */
export async function GET(
  request: NextRequest,
  context: RouteContext
): Promise<NextResponse> {
  try {
    const { tenantId: masterTenantId } = await assertMasterTenantAccess(request);
    const { notificationId } = await context.params;

    const service = new PlatformNotificationService(masterTenantId);
    const reads = await service.getNotificationReads(notificationId);

    return NextResponse.json({ success: true, data: reads });
  } catch (error) {
    console.error('[platform-notifications/:id/reads] GET error:', error);

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
