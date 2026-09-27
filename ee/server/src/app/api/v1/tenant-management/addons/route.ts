/**
 * Tenant Management API - Supported add-ons
 *
 * GET /api/v1/tenant-management/addons
 */

import { NextRequest, NextResponse } from 'next/server';
import { ADD_ON_DESCRIPTIONS, ADD_ON_LABELS, ADD_ONS } from '@alga-psa/types';
import { tenantManagementRouteError } from '../tenantManagementRouteErrors';
import { assertMasterTenantAccess } from '@ee/lib/auth/masterTenantAccess';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    await assertMasterTenantAccess(request);

    const data = Object.values(ADD_ONS).map((addonKey) => ({
      addon_key: addonKey,
      label: ADD_ON_LABELS[addonKey],
      description: ADD_ON_DESCRIPTIONS[addonKey],
    }));

    return NextResponse.json({ success: true, data });
  } catch (error) {
    const routeError = tenantManagementRouteError(error, 'Failed to load tenant add-ons.');
    return NextResponse.json({ success: false, error: routeError.error }, { status: routeError.status });
  }
}
