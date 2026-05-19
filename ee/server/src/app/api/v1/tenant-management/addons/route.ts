/**
 * Tenant Management API - Supported add-ons
 *
 * GET /api/v1/tenant-management/addons
 */

import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@alga-psa/auth';
import { ADD_ON_DESCRIPTIONS, ADD_ON_LABELS, ADD_ONS } from '@alga-psa/types';
import { ApiKeyServiceForApi } from '@/lib/services/apiKeyServiceForApi';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MASTER_BILLING_TENANT_ID = process.env.MASTER_BILLING_TENANT_ID;

function getInternalUserInfo(request: NextRequest): { user_id: string; tenant: string; email?: string } | null {
  const internalRequest = request.headers.get('x-internal-request');
  if (internalRequest !== 'ext-proxy-prefetch') return null;

  const userId = request.headers.get('x-internal-user-id');
  const tenant = request.headers.get('x-internal-user-tenant');
  const email = request.headers.get('x-internal-user-email') || undefined;

  if (!userId || !tenant) return null;
  return { user_id: userId, tenant, email };
}

async function assertMasterTenantAccess(request: NextRequest): Promise<void> {
  if (!MASTER_BILLING_TENANT_ID) {
    throw new Error('MASTER_BILLING_TENANT_ID not configured');
  }

  const internalUser = getInternalUserInfo(request);
  if (internalUser) {
    if (internalUser.tenant !== MASTER_BILLING_TENANT_ID) {
      throw new Error('Forbidden');
    }
    return;
  }

  const apiKey = request.headers.get('x-api-key');
  if (apiKey) {
    const keyRecord = await ApiKeyServiceForApi.validateApiKeyAnyTenant(apiKey);
    if (!keyRecord) throw new Error('Invalid API key');
    if (keyRecord.tenant !== MASTER_BILLING_TENANT_ID) throw new Error('Forbidden');
    return;
  }

  const session = await getSession();
  const user = session?.user as { tenant?: string } | undefined;
  if (!user) throw new Error('Unauthorized');
  if (user.tenant !== MASTER_BILLING_TENANT_ID) throw new Error('Forbidden');
}

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
    const message = error instanceof Error ? error.message : 'Unknown error';
    const status = message === 'Unauthorized' ? 401 : message.includes('Forbidden') ? 403 : 500;
    return NextResponse.json({ success: false, error: message }, { status });
  }
}
