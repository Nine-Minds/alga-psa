/**
 * Appliance Console API — access logging.
 *
 * POST /api/v1/appliance-installs/access — record that an operator opened the
 * Appliance Console (called on iframe load), for the audit trail.
 *
 * Static segment; takes precedence over the sibling [tenantId] dynamic route.
 * Access restricted to MASTER_BILLING_TENANT_ID.
 */

import { NextRequest, NextResponse } from 'next/server';
import { PlatformReportAuditService as ExtensionAuditService, extractClientInfo } from '@ee/lib/platformReports';
import { assertMasterTenantAccess, isAuthError } from '@ee/lib/applianceConsole/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const { tenantId, userId, userEmail } = await assertMasterTenantAccess(request);
    const audit = new ExtensionAuditService(tenantId);

    let details: Record<string, unknown> = {};
    try {
      const body = await request.json();
      if (body && typeof body === 'object' && body.details && typeof body.details === 'object') {
        details = body.details as Record<string, unknown>;
      }
    } catch {
      /* no body or invalid JSON */
    }

    const clientInfo = extractClientInfo(request);
    await audit.logEvent({
      eventType: 'appliance.access',
      userId,
      userEmail,
      details: { ...details, accessedAt: new Date().toISOString() },
      ...clientInfo,
    });

    return NextResponse.json({ success: true, message: 'Access logged' });
  } catch (error) {
    console.error('[appliance-installs/access] POST error:', error);
    if (isAuthError(error)) {
      return NextResponse.json({ success: false, error: (error as Error).message }, { status: 403 });
    }
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
