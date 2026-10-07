/**
 * Appliance Console API — operator-action workflow status.
 *
 * GET /api/v1/appliance-installs/workflows/:workflowId
 *
 * The console polls this after a trigger. Once the workflow is terminal, the
 * audit row the trigger wrote (id carried in the workflow memo) is closed as
 * completed or failed; repeating the update is harmless.
 *
 * Static `workflows` segment: takes precedence over the sibling [tenantId] route.
 * Master tenant only.
 */

import { NextRequest, NextResponse } from 'next/server';
import { PlatformReportAuditService as ExtensionAuditService } from '@ee/lib/platformReports';
import { assertMasterTenantAccess, isMasterTenantAuthError as isAuthError } from '@ee/lib/auth/masterTenantAccess';
import { getApplianceWorkflowStatus, redactWorkflowResult } from '@ee/lib/applianceConsole/workflowClient';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{ workflowId: string }>;
}

const WORKFLOW_ID_RE = /^appliance-[a-z-]+:[A-Za-z0-9-]+:[A-Za-z0-9-]+$/;

export async function GET(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  try {
    const { tenantId: masterTenantId } = await assertMasterTenantAccess(request);
    const { workflowId } = await context.params;

    // Only this console's workflows are inspectable through this route.
    if (!WORKFLOW_ID_RE.test(workflowId)) {
      return NextResponse.json({ success: false, error: 'Invalid workflow id' }, { status: 400 });
    }

    const status = await getApplianceWorkflowStatus(workflowId);
    if (!status) {
      return NextResponse.json({ success: false, error: 'Workflow not found' }, { status: 404 });
    }

    if (status.state !== 'running' && status.audit_log_id) {
      const audit = new ExtensionAuditService(masterTenantId);
      await audit.updateLog(status.audit_log_id, {
        status: status.state === 'completed' ? 'completed' : 'failed',
        ...(status.error ? { errorMessage: status.error } : {}),
        ...(status.result !== undefined ? { details: { result: redactWorkflowResult(status.result) }, mergeDetails: true } : {}),
      });
    }

    return NextResponse.json({ success: true, data: status });
  } catch (error) {
    console.error('[appliance-installs/workflows/:workflowId] GET error:', error);
    if (isAuthError(error)) {
      return NextResponse.json({ success: false, error: (error as Error).message }, { status: 403 });
    }
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
