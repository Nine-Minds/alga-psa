import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@alga-psa/auth';
import { tenantDb } from '@alga-psa/db';
import { getAdminConnection } from '@alga-psa/db/admin';
import { observabilityLogger } from '@/lib/observability/logging';
import { ApiKeyServiceForApi } from '@/lib/services/apiKeyServiceForApi';
import { ADD_ON_DESCRIPTIONS, ADD_ON_LABELS, ADD_ONS } from '@alga-psa/types';
import { tenantManagementRouteError } from '../tenantManagementRouteErrors';

const MASTER_BILLING_TENANT_ID = process.env.MASTER_BILLING_TENANT_ID;

/**
 * Check if this is an internal request from ext-proxy with trusted user info.
 */
function getInternalUserInfo(request: NextRequest): { user_id: string; tenant: string; email?: string } | null {
  const internalRequest = request.headers.get('x-internal-request');
  if (internalRequest !== 'ext-proxy-prefetch') {
    return null;
  }

  const userId = request.headers.get('x-internal-user-id');
  const tenant = request.headers.get('x-internal-user-tenant');
  const email = request.headers.get('x-internal-user-email') || undefined;

  if (!userId || !tenant) {
    return null;
  }

  return { user_id: userId, tenant, email };
}

/**
 * Validate API key auth (used by extension uiProxy calls).
 */
async function getApiKeyAuth(request: NextRequest): Promise<{ user_id: string; tenant: string; email?: string } | null> {
  const apiKey = request.headers.get('x-api-key');
  const extensionId = request.headers.get('x-alga-extension');

  if (!apiKey) {
    return null;
  }

  const keyRecord = await ApiKeyServiceForApi.validateApiKeyAnyTenant(apiKey);
  if (!keyRecord) {
    console.warn('[tenant-management/tenants] Invalid API key');
    return null;
  }

  // Get user info from headers (forwarded by runner from ext-proxy)
  const headerUserId = request.headers.get('x-user-id');
  const headerUserEmail = request.headers.get('x-user-email');

  return {
    user_id: headerUserId || (extensionId ? `extension:${extensionId}` : keyRecord.user_id),
    tenant: keyRecord.tenant,
    email: headerUserEmail || undefined,
  };
}

export async function GET(req: NextRequest) {
  try {
    // Check for internal ext-proxy request first
    const internalUser = getInternalUserInfo(req);
    // Check for API key auth (extension uiProxy calls)
    const apiKeyUser = await getApiKeyAuth(req);
    let userTenant: string;
    let userId: string;
    let userEmail: string | undefined;

    if (internalUser) {
      // Trust the user info from ext-proxy (it already validated the session)
      userTenant = internalUser.tenant;
      userId = internalUser.user_id;
      userEmail = internalUser.email;
    } else if (apiKeyUser) {
      // Trust the API key auth
      userTenant = apiKeyUser.tenant;
      userId = apiKeyUser.user_id;
      userEmail = apiKeyUser.email;
    } else {
      // Normal request - get user from session
      const session = await getSession();

      if (!session?.user) {
        return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
      }

      const user = session.user as any;
      userTenant = user.tenant;
      userId = user.user_id;
      userEmail = user.email;
    }

    if (userTenant !== MASTER_BILLING_TENANT_ID) {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
    }

    // LOG: Access event
    observabilityLogger.info('Tenant list accessed', {
      event_type: 'tenant_management_access',
      action: 'list_tenants',
      accessed_by: userId,
      accessed_by_email: userEmail,
    });

    const knex = await getAdminConnection();

    const adminDb = tenantDb(knex, MASTER_BILLING_TENANT_ID || '__tenant_management_admin_listing__');
    const tenants = await adminDb
      .unscoped('tenants as t', 'tenant management admin listing spans all tenants')
      .select([
        't.tenant',
        't.client_name',
        't.email',
        't.plan',
        't.product_code',
        't.created_at',
      ])
      .orderBy('t.client_name', 'asc');

    const tenantIds = tenants.map((tenant) => tenant.tenant);

    const subscriptionQuery = adminDb
      .unscoped('stripe_subscriptions as s', 'tenant management admin listing aggregates subscriptions across tenants');
    adminDb.tenantJoin(subscriptionQuery, 'stripe_prices as p', 's.stripe_price_id', 'p.stripe_price_id', { type: 'left' });
    adminDb.tenantJoin(subscriptionQuery, 'stripe_products as pr', 'p.stripe_product_id', 'pr.stripe_product_id', { type: 'left' });

    const subscriptionRows = tenantIds.length > 0
      ? await subscriptionQuery
          .whereIn('s.tenant', tenantIds)
          .whereIn('s.status', ['active', 'trialing', 'past_due', 'unpaid'])
          .select([
            's.tenant',
            's.stripe_subscription_external_id',
            's.status',
            's.quantity',
            's.current_period_end',
            's.billing_interval',
            'p.stripe_price_external_id',
            'p.unit_amount',
            'p.currency',
            'p.recurring_interval as price_billing_interval',
            'pr.name as product_name',
            'pr.product_type',
          ])
          .orderBy('s.updated_at', 'desc')
      : [];

    const subscriptionByTenant = new Map<string, Record<string, unknown>>();
    for (const subscription of subscriptionRows) {
      if (!subscriptionByTenant.has(subscription.tenant)) {
        subscriptionByTenant.set(subscription.tenant, subscription);
      }
    }

    const addOnRows = tenantIds.length > 0
      ? await adminDb
          .unscoped('tenant_addons', 'tenant management admin listing aggregates add-ons across tenants')
          .whereIn('tenant', tenantIds)
          .andWhere(function () {
            this.whereNull('expires_at').orWhere('expires_at', '>', knex.fn.now());
          })
          .select(['tenant', 'addon_key', 'activated_at', 'expires_at', 'metadata'])
      : [];

    const addOnsByTenant = new Map<string, Array<Record<string, unknown>>>();
    const validAddOns = new Set<string>(Object.values(ADD_ONS));

    for (const addOn of addOnRows) {
      if (!validAddOns.has(String(addOn.addon_key))) {
        continue;
      }

      const list = addOnsByTenant.get(addOn.tenant) || [];
      list.push({
        addon_key: addOn.addon_key,
        label: ADD_ON_LABELS[addOn.addon_key as ADD_ONS],
        description: ADD_ON_DESCRIPTIONS[addOn.addon_key as ADD_ONS],
        activated_at: addOn.activated_at,
        expires_at: addOn.expires_at,
        metadata: addOn.metadata,
      });
      addOnsByTenant.set(addOn.tenant, list);
    }

    const data = tenants.map((tenant) => {
      const subscription = subscriptionByTenant.get(tenant.tenant) || null;

      return {
        ...tenant,
        subscription_status: subscription?.status ?? null,
        subscription,
        addons: addOnsByTenant.get(tenant.tenant) || [],
      };
    });

    return NextResponse.json({ success: true, data });
  } catch (error) {
    const routeError = tenantManagementRouteError(error, 'Failed to load tenants.');

    observabilityLogger.error('Failed to list tenants', error, {
      event_type: 'tenant_management_error',
    });

    return NextResponse.json({
      success: false,
      error: routeError.error,
    }, { status: routeError.status });
  }
}
