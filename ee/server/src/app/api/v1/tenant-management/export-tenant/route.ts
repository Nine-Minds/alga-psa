import { NextRequest, NextResponse } from 'next/server';
import { tenantDb } from '@alga-psa/db';
import { getAdminConnection } from '@alga-psa/db/admin';
import { observabilityLogger } from '@/lib/observability/logging';
import {
  startTenantExportWorkflow,
  type TenantExportInput,
} from '@ee/lib/tenant-management/workflowClient';
import { tenantManagementRouteError } from '../tenantManagementRouteErrors';
import { assertMasterTenantAccess } from '@ee/lib/auth/masterTenantAccess';

const MASTER_BILLING_TENANT_ID = process.env.MASTER_BILLING_TENANT_ID;

/**
 * POST /api/v1/tenant-management/export-tenant
 *
 * Start a tenant data export workflow.
 * Returns a workflowId for polling status, or waits for completion if quick.
 * Requires master tenant authorization.
 */
export async function POST(req: NextRequest) {
  const startTime = Date.now();

  try {
    if (!MASTER_BILLING_TENANT_ID) {
      return NextResponse.json({ success: false, error: 'MASTER_BILLING_TENANT_ID not configured' }, { status: 500 });
    }

    const { userId, userEmail } = await assertMasterTenantAccess(req);

    const body = await req.json();
    const { tenantId, reason } = body;

    if (!tenantId) {
      return NextResponse.json({ success: false, error: 'tenantId is required' }, { status: 400 });
    }

    // Verify target tenant exists
    const knex = await getAdminConnection();
    const auditLogs = tenantDb(knex, MASTER_BILLING_TENANT_ID).table('extension_audit_logs');
    const targetTenant = await tenantDb(knex, tenantId).table('tenants').first();
    if (!targetTenant) {
      return NextResponse.json({ success: false, error: 'Tenant not found' }, { status: 404 });
    }

    // LOG: Action initiated
    observabilityLogger.info('Export tenant data initiated via Temporal workflow', {
      event_type: 'tenant_management_action',
      action: 'export_tenant_data',
      tenant_id: tenantId,
      triggered_by: userId,
      triggered_by_email: userEmail,
      reason,
    });

    // Log to unified extension audit table
    const [auditRecord] = await auditLogs
      .insert({
        tenant: MASTER_BILLING_TENANT_ID,
        event_type: 'tenant.export_data',
        user_id: userId,
        user_email: userEmail,
        resource_type: 'tenant',
        resource_id: tenantId,
        resource_name: targetTenant.client_name || tenantId,
        status: 'pending',
        details: JSON.stringify({ source: 'ninemindsreporting_extension', reason }),
      })
      .returning('log_id');

    // Start the Temporal workflow
    const exportInput: TenantExportInput = {
      tenantId,
      requestedBy: userId,
      reason,
    };

    const workflowResult = await startTenantExportWorkflow(exportInput);

    if (!workflowResult.available || !workflowResult.result) {
      // Update audit record with failure
      await auditLogs
        .where({ log_id: auditRecord.log_id })
        .update({
          status: 'failed',
          error_message: workflowResult.error || 'Temporal workflow client not available',
        });

      return NextResponse.json({
        success: false,
        error: workflowResult.error || 'Temporal workflow client not available',
      }, { status: 503 });
    }

    const { workflowId, result } = workflowResult;

    observabilityLogger.info('Export workflow started', {
      event_type: 'tenant_management_workflow_started',
      action: 'export_tenant_data',
      tenant_id: tenantId,
      workflow_id: workflowId,
    });

    // Wait for the workflow to complete (with timeout)
    // Most exports complete in seconds, so we wait up to 2 minutes
    const WAIT_TIMEOUT_MS = 120000;

    const timeoutPromise = new Promise<null>((resolve) => {
      setTimeout(() => resolve(null), WAIT_TIMEOUT_MS);
    });

    const exportResult = await Promise.race([result, timeoutPromise]);

    if (exportResult === null) {
      // Workflow is still running, return workflowId for polling
      observabilityLogger.info('Export workflow still in progress, returning workflowId for polling', {
        workflow_id: workflowId,
        tenant_id: tenantId,
      });

      // Update audit record to show workflow is in progress
      await auditLogs
        .where({ log_id: auditRecord.log_id })
        .update({
          status: 'in_progress',
          details: JSON.stringify({
            source: 'ninemindsreporting_extension',
            reason,
            workflowId,
          }),
        });

      return NextResponse.json({
        success: true,
        data: {
          status: 'in_progress',
          workflowId,
          tenantName: targetTenant.client_name,
          message: 'Export started. Poll /export-status for progress.',
        },
      });
    }

    // Workflow completed
    if (!exportResult.success) {
      // Update audit record with failure
      await auditLogs
        .where({ log_id: auditRecord.log_id })
        .update({
          status: 'failed',
          error_message: exportResult.error || 'Export failed',
        });

      return NextResponse.json({
        success: false,
        error: exportResult.error || 'Export failed',
      }, { status: 500 });
    }

    // Update audit record with success
    await auditLogs
      .where({ log_id: auditRecord.log_id })
      .update({
        status: 'completed',
        details: JSON.stringify({
          source: 'ninemindsreporting_extension',
          reason,
          workflowId,
          exportId: exportResult.exportId,
          tableCount: exportResult.tableCount,
          recordCount: exportResult.recordCount,
          fileSizeBytes: exportResult.fileSizeBytes,
          duration_ms: Date.now() - startTime,
        }),
      });

    // LOG: Action completed
    observabilityLogger.info('Export tenant data completed', {
      event_type: 'tenant_management_action_completed',
      action: 'export_tenant_data',
      tenant_id: tenantId,
      workflow_id: workflowId,
      export_id: exportResult.exportId,
      table_count: exportResult.tableCount,
      record_count: exportResult.recordCount,
      duration_ms: Date.now() - startTime,
    });

    return NextResponse.json({
      success: true,
      data: {
        status: 'completed',
        workflowId,
        exportId: exportResult.exportId,
        tenantName: targetTenant.client_name,
        bucket: exportResult.bucket,
        s3Key: exportResult.s3Key,
        tableCount: exportResult.tableCount,
        recordCount: exportResult.recordCount,
        fileSizeBytes: exportResult.fileSizeBytes,
      },
    });
  } catch (error) {
    const routeError = tenantManagementRouteError(error, 'Failed to export tenant data.');

    observabilityLogger.error('Export tenant data failed', error, {
      event_type: 'tenant_management_action_failed',
      action: 'export_tenant_data',
    });

    return NextResponse.json({
      success: false,
      error: routeError.error,
    }, { status: routeError.status });
  }
}
