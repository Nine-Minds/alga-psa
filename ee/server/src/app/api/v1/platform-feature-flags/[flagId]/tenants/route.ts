/**
 * Platform Feature Flags API - Tenant Management endpoints
 *
 * POST /api/v1/platform-feature-flags/:flagId/tenants
 *   body.__action = 'add'    -> Add tenant to flag's release conditions
 *   body.__action = 'remove' -> Remove tenant from flag's release conditions
 *
 * Access restricted to users from MASTER_BILLING_TENANT_ID only.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@alga-psa/users/actions';
import { ApiKeyServiceForApi } from '@/lib/services/apiKeyServiceForApi';
import { PostHogFeatureFlagService } from '@ee/lib/platformFeatureFlags';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MASTER_BILLING_TENANT_ID = process.env.MASTER_BILLING_TENANT_ID;

type RouteContext = {
  params: Promise<{ flagId: string }>;
};

async function assertMasterTenantAccess(request: NextRequest): Promise<{ tenantId: string; userId?: string; userEmail?: string }> {
  if (!MASTER_BILLING_TENANT_ID) {
    throw new Error('MASTER_BILLING_TENANT_ID not configured on server');
  }

  const extensionId = request.headers.get('x-alga-extension');
  const apiKey = request.headers.get('x-api-key');

  if (apiKey) {
    const keyRecord = await ApiKeyServiceForApi.validateApiKeyAnyTenant(apiKey);
    if (keyRecord) {
      if (keyRecord.tenant === MASTER_BILLING_TENANT_ID) {
        const headerUserId = request.headers.get('x-user-id');
        const headerUserEmail = request.headers.get('x-user-email');
        const userId = headerUserId || (extensionId ? `extension:${extensionId}` : keyRecord.user_id);
        const userEmail = headerUserEmail || undefined;
        return { tenantId: MASTER_BILLING_TENANT_ID, userId, userEmail };
      }
      throw new Error('Access denied: API key not authorized for platform feature flags');
    }
  }

  const user = await getCurrentUser();
  if (!user) {
    throw new Error('Authentication required');
  }
  if (user.tenant !== MASTER_BILLING_TENANT_ID) {
    throw new Error('Access denied: Platform feature flags require master tenant access');
  }

  return {
    tenantId: MASTER_BILLING_TENANT_ID,
    userId: user.user_id,
    userEmail: user.email,
  };
}

/**
 * POST /api/v1/platform-feature-flags/:flagId/tenants
 * Dispatches on body.__action: 'add' or 'remove'
 */
export async function POST(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  try {
    await assertMasterTenantAccess(request);

    const { flagId } = await context.params;
    const body = await request.json();
    const flagIdNum = parseInt(flagId, 10);

    if (!body.tenantId || typeof body.tenantId !== 'string') {
      return NextResponse.json(
        { success: false, error: 'tenantId is required' },
        { status: 400 }
      );
    }

    const service = new PostHogFeatureFlagService();

    if (body.__action === 'add') {
      const flag = await service.addTenantToFlag(flagIdNum, body.tenantId);
      return NextResponse.json({ success: true, data: flag });
    }

    if (body.__action === 'remove') {
      const flag = await service.removeTenantFromFlag(flagIdNum, body.tenantId);
      return NextResponse.json({ success: true, data: flag });
    }

    return NextResponse.json(
      { success: false, error: '__action must be "add" or "remove"' },
      { status: 400 }
    );
  } catch (error) {
    console.error('[platform-feature-flags] POST tenants error:', error);

    if (error instanceof Error) {
      if (error.message.includes('Access denied') || error.message.includes('Authentication')) {
        return NextResponse.json({ success: false, error: error.message }, { status: 403 });
      }
    }

    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}

export async function OPTIONS(): Promise<Response> {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  });
}
