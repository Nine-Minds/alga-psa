import { NextRequest, NextResponse } from 'next/server';
import { getTenantExportState } from '@ee/lib/tenant-management/workflowClient';
import { tenantManagementRouteError } from '../tenantManagementRouteErrors';
import { assertMasterTenantAccess } from '@ee/lib/auth/masterTenantAccess';

const MASTER_BILLING_TENANT_ID = process.env.MASTER_BILLING_TENANT_ID;

/**
 * GET /api/v1/tenant-management/export-status?workflowId=xxx
 *
 * Get the status of a tenant export workflow.
 * Requires master tenant authorization.
 */
export async function GET(req: NextRequest) {
  try {
    if (!MASTER_BILLING_TENANT_ID) {
      return NextResponse.json({ success: false, error: 'MASTER_BILLING_TENANT_ID not configured' }, { status: 500 });
    }

    await assertMasterTenantAccess(req);

    const { searchParams } = new URL(req.url);
    const workflowId = searchParams.get('workflowId');

    if (!workflowId) {
      return NextResponse.json({ success: false, error: 'workflowId is required' }, { status: 400 });
    }

    // Query the workflow state
    const stateResult = await getTenantExportState(workflowId);

    if (!stateResult.available) {
      return NextResponse.json({
        success: false,
        error: stateResult.error || 'Temporal workflow client not available',
      }, { status: 503 });
    }

    if (!stateResult.data) {
      // Check if workflow doesn't exist or completed
      const errorMessage = stateResult.error || '';

      // If the workflow is not found, it might have completed - try to get the result
      if (errorMessage.includes('not found') || errorMessage.includes('workflow not found')) {
        return NextResponse.json({
          success: false,
          error: 'Workflow not found. It may have completed or never existed.',
        }, { status: 404 });
      }

      return NextResponse.json({
        success: false,
        error: stateResult.error || 'Failed to get workflow state',
      }, { status: 500 });
    }

    const state = stateResult.data;

    return NextResponse.json({
      success: true,
      data: {
        workflowId,
        status: state.status,
        step: state.step,
        exportId: state.exportId,
        tenantId: state.tenantId,
        tenantName: state.tenantName,
        progress: state.progress,
        currentTable: state.currentTable,
        bucket: state.bucket,
        s3Key: state.s3Key,
        fileSizeBytes: state.fileSizeBytes,
        tableCount: state.tableCount,
        recordCount: state.recordCount,
        error: state.error,
        startedAt: state.startedAt,
        completedAt: state.completedAt,
      },
    });
  } catch (error) {
    const routeError = tenantManagementRouteError(error, 'Failed to get tenant export status.');

    return NextResponse.json({
      success: false,
      error: routeError.error,
    }, { status: routeError.status });
  }
}
