/**
 * Platform Feature Flags API - List and Create endpoints
 *
 * GET  /api/v1/platform-feature-flags - List all feature flags
 * POST /api/v1/platform-feature-flags - Create a new feature flag
 *
 * Access restricted to users from MASTER_BILLING_TENANT_ID only.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@alga-psa/users/actions';
import { ApiKeyServiceForApi } from '@/lib/services/apiKeyServiceForApi';
import { ENTRA_PHASE1_FLAG_DEFINITIONS, PostHogFeatureFlagService } from '@ee/lib/platformFeatureFlags';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MASTER_BILLING_TENANT_ID = process.env.MASTER_BILLING_TENANT_ID;

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
 * GET /api/v1/platform-feature-flags
 * List all feature flags from PostHog
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    await assertMasterTenantAccess(request);

    const service = new PostHogFeatureFlagService();
    const flags = await service.listFlags();

    const includeEntraDefaults =
      request.nextUrl.searchParams.get('includeEntraPhase1Defaults') === 'true';

    if (!includeEntraDefaults) {
      return NextResponse.json({ success: true, data: flags });
    }

    return NextResponse.json({
      success: true,
      data: flags,
      defaults: {
        entraPhase1: ENTRA_PHASE1_FLAG_DEFINITIONS,
      },
    });
  } catch (error) {
    console.error('[platform-feature-flags] GET error:', error);

    if (error instanceof Error) {
      if (error.message.includes('Access denied') || error.message.includes('Authentication')) {
        return NextResponse.json({ success: false, error: error.message }, { status: 403 });
      }
      if (error.message.includes('not configured')) {
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
      }
    }

    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * POST /api/v1/platform-feature-flags
 * Create a new feature flag in PostHog
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    await assertMasterTenantAccess(request);

    const body = await request.json();
    const service = new PostHogFeatureFlagService();

    if (body?.__action === 'ensure_entra_phase1_flags') {
      const ensured = await service.ensureEntraPhase1Flags();
      return NextResponse.json({ success: true, data: ensured });
    }

    if (!body.key || typeof body.key !== 'string') {
      return NextResponse.json({ success: false, error: 'key is required' }, { status: 400 });
    }

    const flag = await service.createFlag({
      key: body.key,
      name: body.name,
      active: body.active,
      filters: body.filters,
      tags: body.tags,
    });

    return NextResponse.json({ success: true, data: flag }, { status: 201 });
  } catch (error) {
    console.error('[platform-feature-flags] POST error:', error);

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
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  });
}
