import { NextRequest, NextResponse } from 'next/server';
import { tenantDb } from '@alga-psa/db';
import { getAdminConnection } from '@alga-psa/db/admin';
import { startTenantDeletionWorkflow } from '@ee/lib/tenant-management/workflowClient';
import { observabilityLogger } from '@/lib/observability/logging';
import { tenantManagementRouteError } from '../tenantManagementRouteErrors';
import { assertMasterTenantAccess } from '@ee/lib/auth/masterTenantAccess';

const MASTER_BILLING_TENANT_ID = process.env.MASTER_BILLING_TENANT_ID;

/**
 * POST /api/v1/tenant-management/start-deletion
 *
 * Start a tenant deletion workflow.
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
    const targetTenantDb = tenantDb(knex, tenantId);
    const auditLogs = tenantDb(knex, MASTER_BILLING_TENANT_ID).table('extension_audit_logs');
    const targetTenant = await targetTenantDb.table('tenants').first();
    if (!targetTenant) {
      return NextResponse.json({ success: false, error: 'Tenant not found' }, { status: 404 });
    }

    // Check for existing pending deletion
    const existingDeletion = await targetTenantDb.table('pending_tenant_deletions')
      .whereNotIn('status', ['deleted', 'rolled_back', 'failed'])
      .first();

    if (existingDeletion) {
      return NextResponse.json({
        success: false,
        error: 'A deletion workflow is already in progress for this tenant',
        existingWorkflowId: existingDeletion.workflow_id,
        existingStatus: existingDeletion.status,
      }, { status: 409 });
    }

    // LOG: Action initiated
    observabilityLogger.info('Start tenant deletion initiated', {
      event_type: 'tenant_management_action',
      action: 'start_tenant_deletion',
      tenant_id: tenantId,
      triggered_by: userId,
      triggered_by_email: userEmail,
      reason,
    });

    // Log to unified extension audit table (pending status)
    const [auditRecord] = await auditLogs
      .insert({
        tenant: MASTER_BILLING_TENANT_ID,
        event_type: 'tenant.start_deletion',
        user_id: userId,
        user_email: userEmail,
        resource_type: 'tenant',
        resource_id: tenantId,
        resource_name: targetTenant.client_name || tenantId,
        status: 'pending',
        details: JSON.stringify({ source: 'ninemindsreporting_extension', reason }),
      })
      .returning('log_id');

    // Trigger Temporal workflow
    const clientResult = await startTenantDeletionWorkflow({
      tenantId,
      triggerSource: 'nineminds_extension',
      triggeredBy: userId,
      reason,
    });

    if (!clientResult.available) {
      // Update audit record with failure
      await auditLogs
        .where({ log_id: auditRecord.log_id })
        .update({
          status: 'failed',
          error_message: clientResult.error || 'Temporal workflow client not available',
        });

      return NextResponse.json({
        success: false,
        error: clientResult.error || 'Temporal workflow client not available',
      }, { status: 503 });
    }

    const { workflowId, runId } = clientResult;

    // Update audit record with workflow ID
    await auditLogs
      .where({ log_id: auditRecord.log_id })
      .update({
        workflow_id: workflowId,
        status: 'completed',
        details: JSON.stringify({
          source: 'ninemindsreporting_extension',
          reason,
          workflowId,
          runId,
          duration_ms: Date.now() - startTime,
        }),
      });

    // LOG: Action completed
    observabilityLogger.info('Start tenant deletion completed', {
      event_type: 'tenant_management_action_completed',
      action: 'start_tenant_deletion',
      tenant_id: tenantId,
      workflow_id: workflowId,
      duration_ms: Date.now() - startTime,
    });

    return NextResponse.json({
      success: true,
      workflowId,
      runId,
      tenantName: targetTenant.client_name,
      message: 'Tenant deletion workflow started. Users deactivated. Awaiting confirmation signal.',
    });
  } catch (error) {
    const routeError = tenantManagementRouteError(error, 'Failed to start tenant deletion.');

    observabilityLogger.error('Start tenant deletion failed', error, {
      event_type: 'tenant_management_action_failed',
      action: 'start_tenant_deletion',
    });

    return NextResponse.json({
      success: false,
      error: routeError.error,
    }, { status: routeError.status });
  }
}
