/**
 * Appliance Console API — audit trail for one appliance tenant.
 *
 * GET /api/v1/appliance-installs/:tenantId/audit?limit=100
 *
 * Returns extension_audit_logs rows with resource_type 'appliance' and this
 * tenant as resource_id, newest first. Master tenant only.
 */

import { NextRequest, NextResponse } from 'next/server';
import { PlatformReportAuditService as ExtensionAuditService, extractClientInfo } from '@ee/lib/platformReports';
import { assertMasterTenantAccess, isMasterTenantAuthError as isAuthError } from '@ee/lib/auth/masterTenantAccess';

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

    const { searchParams } = new URL(request.url);
    const limitRaw = parseInt(searchParams.get('limit') || '100', 10);
    const limit = Math.min(Math.max(Number.isFinite(limitRaw) ? limitRaw : 100, 1), 500);

    const logs = await audit.listLogs({ resourceType: 'appliance', resourceId: tenantId, limit });

    const clientInfo = extractClientInfo(request);
    await audit.logEvent({
      eventType: 'appliance.audit.view',
      userId,
      userEmail,
      resourceType: 'appliance',
      resourceId: tenantId,
      details: { count: logs.length },
      ...clientInfo,
    });

    return NextResponse.json({ success: true, data: logs });
  } catch (error) {
    console.error('[appliance-installs/:tenantId/audit] GET error:', error);
    if (isAuthError(error)) {
      return NextResponse.json({ success: false, error: (error as Error).message }, { status: 403 });
    }
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
