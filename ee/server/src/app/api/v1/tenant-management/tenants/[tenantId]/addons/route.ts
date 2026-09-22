/**
 * Tenant Management API - Grant/revoke tenant add-ons
 *
 * POST /api/v1/tenant-management/tenants/:tenantId/addons
 */

import { NextRequest, NextResponse } from 'next/server';
import { tenantDb } from '@alga-psa/db';
import { getAdminConnection } from '@alga-psa/db/admin';
import { ADD_ON_LABELS, ADD_ONS, type AddOnKey } from '@alga-psa/types';
import { observabilityLogger } from '@/lib/observability/logging';
import { tenantManagementRouteError } from '../../../tenantManagementRouteErrors';
import { assertMasterTenantAccess } from '@ee/lib/auth/masterTenantAccess';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MASTER_BILLING_TENANT_ID = process.env.MASTER_BILLING_TENANT_ID;

type RouteContext = {
  params: Promise<{ tenantId: string }>;
};

function isValidAddOnKey(addonKey: unknown): addonKey is AddOnKey {
  return typeof addonKey === 'string' && Object.values(ADD_ONS).includes(addonKey as ADD_ONS);
}

export async function POST(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  try {
    const { userId, userEmail } = await assertMasterTenantAccess(request);
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
    const targetTenantDb = tenantDb(knex, tenantId);
    const auditLogs = tenantDb(knex, MASTER_BILLING_TENANT_ID).table('extension_audit_logs');
    const tenant = await targetTenantDb.table('tenants')
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
      await targetTenantDb.table('tenant_addons')
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
      await targetTenantDb.table('tenant_addons')
        .where({ addon_key: addonKey })
        .update({
          expires_at: nowIso,
          metadata: JSON.stringify(metadata),
        });
    }

    await auditLogs.insert({
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
    const routeError = tenantManagementRouteError(error, 'Failed to update tenant add-on.');

    observabilityLogger.error('Failed to update tenant add-on', error, {
      event_type: 'tenant_management_error',
    });

    return NextResponse.json({ success: false, error: routeError.error }, { status: routeError.status });
  }
}
