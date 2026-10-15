import { NextRequest, NextResponse } from 'next/server';
import { PlatformReportAuditService } from '@ee/lib/platformReports';
import { tenantManagementRouteError } from '../tenantManagementRouteErrors';
import { assertMasterTenantAccess } from '@ee/lib/auth/masterTenantAccess';

const MASTER_BILLING_TENANT_ID = process.env.MASTER_BILLING_TENANT_ID;

export async function GET(req: NextRequest) {
  try {
    await assertMasterTenantAccess(req);

    const { searchParams } = new URL(req.url);
    const eventType = searchParams.get('eventType') as any || undefined;
    const eventTypePrefix = searchParams.get('eventTypePrefix') || undefined;  // e.g., 'tenant.' for all tenant events
    const resourceType = searchParams.get('resourceType') as any || undefined;
    const limit = parseInt(searchParams.get('limit') || '100', 10);

    const auditService = new PlatformReportAuditService(MASTER_BILLING_TENANT_ID!);
    const logs = await auditService.listLogs({
      eventType,
      eventTypePrefix,
      resourceType,
      limit,
    });

    return NextResponse.json({ success: true, data: logs });
  } catch (error) {
    const routeError = tenantManagementRouteError(error, 'Failed to load tenant management audit log.');

    return NextResponse.json({
      success: false,
      error: routeError.error,
    }, { status: routeError.status });
  }
}
