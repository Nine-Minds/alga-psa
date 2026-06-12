/**
 * Tenant Management API - Grant/revoke tenant add-ons
 *
 * POST /api/v1/tenant-management/tenants/:tenantId/addons
 */

import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@alga-psa/auth';
import { getAdminConnection } from '@alga-psa/db/admin';
import { ADD_ON_LABELS, ADD_ONS, type AddOnKey } from '@alga-psa/types';
import { ApiKeyServiceForApi } from '@/lib/services/apiKeyServiceForApi';
import { observabilityLogger } from '@/lib/observability/logging';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MASTER_BILLING_TENANT_ID = process.env.MASTER_BILLING_TENANT_ID;

type RouteContext = {
  params: Promise<{ tenantId: string }>;
};

function getInternalUserInfo(request: NextRequest): { user_id: string; tenant: string; email?: string } | null {
  const internalRequest = request.headers.get('x-internal-request');
  if (internalRequest !== 'ext-proxy-prefetch') return null;

  const userId = request.headers.get('x-internal-user-id');
  const tenant = request.headers.get('x-internal-user-tenant');
  const email = request.headers.get('x-internal-user-email') || undefined;

  if (!userId || !tenant) return null;
  return { user_id: userId, tenant, email };
}

async function getAuthorizedUser(request: NextRequest): Promise<{ userId: string; userEmail?: string }> {
  if (!MASTER_BILLING_TENANT_ID) {
    throw new Error('MASTER_BILLING_TENANT_ID not configured');
  }

  const internalUser = getInternalUserInfo(request);
  if (internalUser) {
    if (internalUser.tenant !== MASTER_BILLING_TENANT_ID) throw new Error('Forbidden');
    return { userId: internalUser.user_id, userEmail: internalUser.email };
  }

  const apiKey = request.headers.get('x-api-key');
  if (apiKey) {
    const keyRecord = await ApiKeyServiceForApi.validateApiKeyAnyTenant(apiKey);
    if (!keyRecord) throw new Error('Invalid API key');
    if (keyRecord.tenant !== MASTER_BILLING_TENANT_ID) throw new Error('Forbidden');

    const extensionId = request.headers.get('x-alga-extension');
    const headerUserId = request.headers.get('x-user-id');
    const headerUserEmail = request.headers.get('x-user-email');

    return {
      userId: headerUserId || (extensionId ? `extension:${extensionId}` : keyRecord.user_id),
      userEmail: headerUserEmail || undefined,
    };
  }

  const session = await getSession();
  const user = session?.user as { tenant?: string; user_id?: string; email?: string } | undefined;
  if (!user?.user_id) throw new Error('Unauthorized');
  if (user.tenant !== MASTER_BILLING_TENANT_ID) throw new Error('Forbidden');

  return { userId: user.user_id, userEmail: user.email };
}

function isValidAddOnKey(addonKey: unknown): addonKey is AddOnKey {
  return typeof addonKey === 'string' && Object.values(ADD_ONS).includes(addonKey as ADD_ONS);
}

export async function POST(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  try {
    const { userId, userEmail } = await getAuthorizedUser(request);
    const { tenantId } = await context.params;
    const body = await request.json();
    const action = body?.action;
    const addonKey = body?.addonKey;

    if (!tenantId) {
      return NextResponse.json({ success: false, error: 'tenantId is required' }, { status: 400 });
    }

    if (action !== 'grant' && action !== 'revoke') {
      return NextResponse.json({ success: false, error: 'action must be "grant" or "revoke"' }, { status: 400 });
    }

    if (!isValidAddOnKey(addonKey)) {
      return NextResponse.json({ success: false, error: 'Invalid addonKey' }, { status: 400 });
    }

    const knex = await getAdminConnection();
    const tenant = await knex('tenants')
      .where({ tenant: tenantId })
      .select(['tenant', 'client_name'])
      .first();

    if (!tenant) {
      return NextResponse.json({ success: false, error: 'Tenant not found' }, { status: 404 });
    }

    const nowIso = new Date().toISOString();
    const metadata = {
      source: 'nineminds_control_panel',
      action,
      user_id: userId,
      user_email: userEmail,
      updated_at: nowIso,
    };

    if (action === 'grant') {
      // Citus rejects STABLE functions (knex.fn.now() → CURRENT_TIMESTAMP) inside
      // ON CONFLICT DO UPDATE SET on distributed tables — must pass a literal.
      await knex('tenant_addons')
        .insert({
          tenant: tenantId,
          addon_key: addonKey,
          activated_at: nowIso,
          expires_at: null,
          metadata: JSON.stringify(metadata),
        })
        .onConflict(['tenant', 'addon_key'])
        .merge({
          activated_at: nowIso,
          expires_at: null,
          metadata: JSON.stringify(metadata),
        });
    } else {
      await knex('tenant_addons')
        .where({ tenant: tenantId, addon_key: addonKey })
        .update({
          expires_at: nowIso,
          metadata: JSON.stringify(metadata),
        });
    }

    await knex('extension_audit_logs').insert({
      tenant: MASTER_BILLING_TENANT_ID,
      event_type: action === 'grant' ? 'tenant.addon_grant' : 'tenant.addon_revoke',
      user_id: userId,
      user_email: userEmail,
      resource_type: 'tenant',
      resource_id: tenantId,
      resource_name: tenant.client_name,
      status: 'completed',
      details: JSON.stringify({
        source: 'ninemindsreporting_extension',
        addon_key: addonKey,
        addon_label: ADD_ON_LABELS[addonKey as ADD_ONS],
      }),
    });

    observabilityLogger.info('Tenant add-on updated', {
      event_type: 'tenant_management_action',
      action: action === 'grant' ? 'grant_addon' : 'revoke_addon',
      tenant_id: tenantId,
      addon_key: addonKey,
      triggered_by: userId,
      triggered_by_email: userEmail,
    });

    return NextResponse.json({
      success: true,
      message: `${ADD_ON_LABELS[addonKey as ADD_ONS]} ${action === 'grant' ? 'granted' : 'revoked'} for ${tenant.client_name}`,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    const status = message === 'Unauthorized' ? 401 : message.includes('Forbidden') ? 403 : 500;

    observabilityLogger.error('Failed to update tenant add-on', error, {
      event_type: 'tenant_management_error',
    });

    return NextResponse.json({ success: false, error: message }, { status });
  }
}
