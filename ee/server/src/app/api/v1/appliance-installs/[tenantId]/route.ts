/**
 * Appliance Console API — appliance install detail.
 *
 * GET /api/v1/appliance-installs/:tenantId — registry tenant detail (entitlement,
 * install codes, appliances) for one appliance.
 *
 * Access restricted to MASTER_BILLING_TENANT_ID. Thin read-proxy to alga-license
 * (C4) GET /tenants/:tenant_id.
 */

import { NextRequest, NextResponse } from 'next/server';
import { PlatformReportAuditService as ExtensionAuditService, extractClientInfo } from '@ee/lib/platformReports';
import { assertMasterTenantAccess, isAuthError } from '@ee/lib/applianceConsole/auth';
import { getApplianceTenant } from '@ee/lib/applianceConsole/algaLicenseAdminClient';

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

    const clientInfo = extractClientInfo(request);
    await audit.logEvent({
      eventType: 'appliance.view',
      userId,
      userEmail,
      resourceType: 'appliance',
      resourceId: tenantId,
      resourceName: detail.tenant.company_name,
      ...clientInfo,
    });

    return NextResponse.json({ success: true, data: detail });
  } catch (error) {
    console.error('[appliance-installs/:tenantId] GET error:', error);
    if (isAuthError(error)) {
      return NextResponse.json({ success: false, error: (error as Error).message }, { status: 403 });
    }
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
