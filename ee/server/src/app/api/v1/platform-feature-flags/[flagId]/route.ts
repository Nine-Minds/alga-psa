/**
 * Platform Feature Flags API - Single Flag endpoints
 *
 * GET    /api/v1/platform-feature-flags/:flagId - Get a single flag
 * POST   /api/v1/platform-feature-flags/:flagId - Method override (uiProxy)
 * PATCH  /api/v1/platform-feature-flags/:flagId - Update a flag
 * DELETE /api/v1/platform-feature-flags/:flagId - Delete a flag
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

function errorResponse(error: unknown, context: string): NextResponse {
  console.error(`[platform-feature-flags] ${context} error:`, error);

  if (error instanceof Error) {
    if (error.message.includes('Access denied') || error.message.includes('Authentication')) {
      return NextResponse.json({ success: false, error: error.message }, { status: 403 });
    }
  }

  const detail = error instanceof Error ? error.message : String(error);
  return NextResponse.json({ success: false, error: 'Internal server error', detail }, { status: 500 });
}

/**
 * GET /api/v1/platform-feature-flags/:flagId
 */
export async function GET(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  try {
    await assertMasterTenantAccess(request);

    const { flagId } = await context.params;
    const service = new PostHogFeatureFlagService();
    const flag = await service.getFlag(parseInt(flagId, 10));

    return NextResponse.json({ success: true, data: flag });
  } catch (error) {
    return errorResponse(error, 'GET');
  }
}

/**
 * POST /api/v1/platform-feature-flags/:flagId
 * Method override: body.__method = 'PATCH' or 'DELETE'
 */
export async function POST(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  try {
    const body = await request.json();

    if (body.__method === 'PATCH') {
      const { __method, __action, ...updateData } = body;
      // Reconstruct request with update data
      const patchRequest = new NextRequest(request.url, {
        method: 'PATCH',
        headers: request.headers,
        body: JSON.stringify(updateData),
      });
      return handlePatch(patchRequest, context);
    }

    if (body.__method === 'DELETE') {
      return handleDelete(request, context);
    }

    // Default: treat as GET
    return GET(request, context);
  } catch (error) {
    return errorResponse(error, 'POST');
  }
}

/**
 * PATCH /api/v1/platform-feature-flags/:flagId
 */
export async function PATCH(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  return handlePatch(request, context);
}

async function handlePatch(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  try {
    await assertMasterTenantAccess(request);

    const { flagId } = await context.params;
    const body = await request.json();

    // Strip internal fields
    const { __method, __action, ...updates } = body;

    const service = new PostHogFeatureFlagService();
    const flag = await service.updateFlag(parseInt(flagId, 10), updates);

    return NextResponse.json({ success: true, data: flag });
  } catch (error) {
    return errorResponse(error, 'PATCH');
  }
}

/**
 * DELETE /api/v1/platform-feature-flags/:flagId
 */
export { handleDelete as DELETE };

async function handleDelete(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  try {
    await assertMasterTenantAccess(request);

    const { flagId } = await context.params;
    const service = new PostHogFeatureFlagService();
    await service.deleteFlag(parseInt(flagId, 10));

    return NextResponse.json({ success: true, message: 'Flag deleted' });
  } catch (error) {
    return errorResponse(error, 'DELETE');
  }
}

export async function OPTIONS(): Promise<Response> {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  });
}
