/**
 * Appliance Console API — Stripe subscription next to the C4 entitlement.
 *
 * GET /api/v1/appliance-installs/:tenantId/billing
 *
 * Appliance subscriptions are minted by nm-store, so they are not in the master
 * tenant's stripe tables; this reads Stripe by subscription id. `billing` is
 * null for essentials tenants and for comp entitlements (no subscription).
 * Master tenant only.
 */

import { NextRequest, NextResponse } from 'next/server';
import { PlatformReportAuditService as ExtensionAuditService, extractClientInfo } from '@ee/lib/platformReports';
import { assertMasterTenantAccess, isMasterTenantAuthError as isAuthError } from '@ee/lib/auth/masterTenantAccess';
import { getApplianceTenant, isCompSubscriptionId } from '@ee/lib/applianceConsole/algaLicenseAdminClient';
import { getApplianceBilling, type ApplianceBillingResponse } from '@ee/lib/applianceConsole/stripeBilling';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{ tenantId: string }>;
}

export async function GET(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  try {
    const { tenantId: masterTenantId, userId, userEmail } = await assertMasterTenantAccess(request);
    const { tenantId } = await context.params;
    const audit = new ExtensionAuditService(masterTenantId);

    const detail = await getApplianceTenant(tenantId);
    if (!detail) {
      return NextResponse.json({ success: false, error: 'Appliance tenant not found' }, { status: 404 });
    }

    const ent = detail.entitlement;
    let data: ApplianceBillingResponse;
    if (!ent || ent.kind === 'comp' || isCompSubscriptionId(ent.stripe_sub_id)) {
      data = { billing: null, entitlement_seats: ent?.seats ?? null, drift: { seats_mismatch: false, status_mismatch: false } };
    } else {
      data = await getApplianceBilling(ent.stripe_sub_id, { seats: ent.seats, active: ent.active });
    }

    const clientInfo = extractClientInfo(request);
    await audit.logEvent({
      eventType: 'appliance.billing.view',
      userId,
      userEmail,
      resourceType: 'appliance',
      resourceId: tenantId,
      resourceName: detail.tenant.company_name,
      details: { stripe_sub_id: ent?.stripe_sub_id ?? null, drift: data.drift },
      ...clientInfo,
    });

    return NextResponse.json({ success: true, data });
  } catch (error) {
    console.error('[appliance-installs/:tenantId/billing] GET error:', error);
    if (isAuthError(error)) {
      return NextResponse.json({ success: false, error: (error as Error).message }, { status: 403 });
    }
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
