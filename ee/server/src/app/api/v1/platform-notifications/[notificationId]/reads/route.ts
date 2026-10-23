/**
 * Platform Notifications API - Per-user read/dismiss details
 *
 * GET /api/v1/platform-notifications/:notificationId/reads - Get per-user interaction data
 *
 * Access restricted to users from MASTER_BILLING_TENANT_ID only.
 */

import { NextRequest, NextResponse } from 'next/server';
import { PlatformNotificationService } from '@ee/lib/platformNotifications';
import { assertMasterTenantAccess } from '@ee/lib/auth/masterTenantAccess';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MASTER_BILLING_TENANT_ID = process.env.MASTER_BILLING_TENANT_ID;

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
