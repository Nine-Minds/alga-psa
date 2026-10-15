/**
 * Platform Feature Flags API - List and Create endpoints
 *
 * GET  /api/v1/platform-feature-flags - List all feature flags
 * POST /api/v1/platform-feature-flags - Create a new feature flag
 *
 * Access restricted to users from MASTER_BILLING_TENANT_ID only.
 */

import { NextRequest, NextResponse } from 'next/server';
import { ENTRA_PHASE1_FLAG_DEFINITIONS, PostHogFeatureFlagService } from '@ee/lib/platformFeatureFlags';
import { assertMasterTenantAccess } from '@ee/lib/auth/masterTenantAccess';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MASTER_BILLING_TENANT_ID = process.env.MASTER_BILLING_TENANT_ID;

function platformFeatureFlagsRouteError(error: unknown): { status: number; error: string } {
  if (!(error instanceof Error)) {
    return { status: 500, error: 'Internal server error' };
  }

  if (error.message.includes('Access denied') || error.message.includes('Authentication')) {
    return {
      status: 403,
      error: 'Permission denied: platform feature flags require master tenant access.',
    };
  }

  if (error.message.includes('not configured')) {
    return {
      status: 500,
      error: 'Platform feature flag service is not configured.',
    };
  }

  return { status: 500, error: 'Internal server error' };
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

    const routeError = platformFeatureFlagsRouteError(error);
    return NextResponse.json({ success: false, error: routeError.error }, { status: routeError.status });
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

    const routeError = platformFeatureFlagsRouteError(error);
    return NextResponse.json({ success: false, error: routeError.error }, { status: routeError.status });
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
