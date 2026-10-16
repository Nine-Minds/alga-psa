/**
 * Appliance Console API — appliance install detail.
 *
 * GET  /api/v1/appliance-installs/:tenantId — registry tenant detail (entitlement,
 *      codes, appliances, per-appliance token state) for one appliance.
 * POST /api/v1/appliance-installs/:tenantId with body { __method: 'PATCH', ... } —
 *      update company/contact (the extension runner's proxy is GET/POST only).
 *
 * Access restricted to MASTER_BILLING_TENANT_ID. Thin read-proxy to alga-license
 * (C4) GET /tenants/:tenant_id.
 */

import { NextRequest, NextResponse } from 'next/server';
import { PlatformReportAuditService as ExtensionAuditService, extractClientInfo } from '@ee/lib/platformReports';
import { assertMasterTenantAccess, isMasterTenantAuthError as isAuthError } from '@ee/lib/auth/masterTenantAccess';
import { getApplianceTenant } from '@ee/lib/applianceConsole/algaLicenseAdminClient';
import { handleApplianceTrigger } from '@ee/lib/applianceConsole/triggerRoute';
import { parseUpdateTenant } from '@ee/lib/applianceConsole/actionInputs';

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

export async function POST(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  const { tenantId } = await context.params;
  let body: Record<string, unknown> = {};
  try {
    const parsed = await request.json();
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) body = parsed as Record<string, unknown>;
  } catch {
    /* no body */
  }

  const method = typeof body.__method === 'string' ? body.__method.toUpperCase() : 'POST';
  if (method !== 'PATCH') {
    return NextResponse.json(
      { success: false, error: 'Unsupported method. Send { "__method": "PATCH" } to update the tenant.' },
      { status: 405 },
    );
  }

  return handleApplianceTrigger(
    {
      action: 'update',
      eventType: 'appliance.update',
      parse: (b, id, base) => parseUpdateTenant(b, id!, base),
    },
    request,
    tenantId,
    body,
  );
}
