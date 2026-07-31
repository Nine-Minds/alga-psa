/**
 * Appliance Console API — list appliance installs.
 *
 * GET /api/v1/appliance-installs — list registry tenants (deployment_type=appliance).
 *
 * Access restricted to MASTER_BILLING_TENANT_ID. Thin read-proxy: forwards to the
 * alga-license service (C4) GET /tenants with the server-held service secret and
 * audits the access. No license data or credentials reach the extension/browser.
 */

import { NextRequest, NextResponse } from 'next/server';
import { PlatformReportAuditService as ExtensionAuditService, extractClientInfo } from '@ee/lib/platformReports';
import { assertMasterTenantAccess, isAuthError } from '@ee/lib/applianceConsole/auth';
import { listApplianceTenants } from '@ee/lib/applianceConsole/algaLicenseAdminClient';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const { tenantId, userId, userEmail } = await assertMasterTenantAccess(request);
    const audit = new ExtensionAuditService(tenantId);

    const { searchParams } = new URL(request.url);
    const limitRaw = searchParams.get('limit');
    const limit = limitRaw ? Math.min(Math.max(parseInt(limitRaw, 10) || 0, 1), 200) : undefined;

    const result = await listApplianceTenants({
      query: searchParams.get('query') || undefined,
      edition: searchParams.get('edition') || undefined,
      product_code: searchParams.get('product_code') || undefined,
      status: searchParams.get('status') || undefined,
      limit,
      cursor: searchParams.get('cursor') || undefined,
    });

    const clientInfo = extractClientInfo(request);
    await audit.logEvent({
      eventType: 'appliance.list',
      userId,
      userEmail,
      details: { count: result.items.length },
      ...clientInfo,
    });

    return NextResponse.json({ success: true, data: result.items, next_cursor: result.next_cursor });
  } catch (error) {
    console.error('[appliance-installs] GET error:', error);
    if (isAuthError(error)) {
      return NextResponse.json({ success: false, error: (error as Error).message }, { status: 403 });
    }
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
