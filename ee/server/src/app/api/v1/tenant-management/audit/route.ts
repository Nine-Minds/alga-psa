import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/actions/user-actions/userActions';
import { ExtensionAuditService } from '@ee/lib/platformReports';

const MASTER_BILLING_TENANT_ID = process.env.MASTER_BILLING_TENANT_ID;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Credentials': 'true',
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders });
}

export async function GET(req: NextRequest) {
  try {
    const user = await getCurrentUser();

    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401, headers: corsHeaders });
    }

    if (user.tenant !== MASTER_BILLING_TENANT_ID) {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403, headers: corsHeaders });
    }

    const { searchParams } = new URL(req.url);
    const eventType = searchParams.get('eventType') as any || undefined;
    const eventTypePrefix = searchParams.get('eventTypePrefix') || undefined;  // e.g., 'tenant.' for all tenant events
    const resourceType = searchParams.get('resourceType') as any || undefined;
    const limit = parseInt(searchParams.get('limit') || '100', 10);

    const auditService = new ExtensionAuditService(MASTER_BILLING_TENANT_ID!);
    const logs = await auditService.listLogs({
      eventType,
      eventTypePrefix,
      resourceType,
      limit,
    });

    return NextResponse.json({ success: true, data: logs }, { headers: corsHeaders });
  } catch (error) {
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }, { status: 500, headers: corsHeaders });
  }
}
