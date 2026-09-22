import { NextRequest, NextResponse } from 'next/server';
import { tenantDb } from '@alga-psa/db';
import { getAdminConnection } from '@alga-psa/db/admin';
import { rollbackTenantDeletion } from '@ee/lib/tenant-management/workflowClient';
import { observabilityLogger } from '@/lib/observability/logging';
import { tenantManagementRouteError } from '../tenantManagementRouteErrors';
import { assertMasterTenantAccess } from '@ee/lib/auth/masterTenantAccess';

const MASTER_BILLING_TENANT_ID = process.env.MASTER_BILLING_TENANT_ID;

/**
 * POST /api/v1/tenant-management/rollback-deletion
 *
 * Send rollback signal to a tenant deletion workflow.
 * This will reactivate users and cancel the deletion.
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
    const { workflowId, reason } = body;

    if (!workflowId) {
      return NextResponse.json({ success: false, error: 'workflowId is required' }, { status: 400 });
    }

    // Verify pending deletion exists
    const knex = await getAdminConnection();
    const auditLogs = tenantDb(knex, MASTER_BILLING_TENANT_ID).table('extension_audit_logs');
    const pendingDeletion = await tenantDb(knex, '__tenant_deletion_rollback_lookup__')
      .unscoped('pending_tenant_deletions', 'tenant deletion rollback resolves tenant by workflow id before tenant context exists')
      .where({ workflow_id: workflowId })
      .first();

    if (!pendingDeletion) {
      return NextResponse.json({ success: false, error: 'Pending deletion not found' }, { status: 404 });
    }

    if (pendingDeletion.status === 'deleted') {
      return NextResponse.json({ success: false, error: 'Tenant has already been deleted and cannot be rolled back' }, { status: 400 });
    }

    if (pendingDeletion.status === 'rolled_back') {
      return NextResponse.json({ success: false, error: 'Deletion was already rolled back' }, { status: 400 });
    }

    if (pendingDeletion.status === 'deleting') {
      return NextResponse.json({ success: false, error: 'Deletion is in progress and cannot be rolled back' }, { status: 400 });
    }

    // LOG: Action initiated
    observabilityLogger.info('Rollback tenant deletion initiated', {
      event_type: 'tenant_management_action',
      action: 'rollback_tenant_deletion',
      tenant_id: pendingDeletion.tenant,
      workflow_id: workflowId,
      reason,
      triggered_by: userId,
    });

    // Log to unified extension audit table
    await auditLogs
      .insert({
        tenant: MASTER_BILLING_TENANT_ID,
        event_type: 'tenant.rollback_deletion',
        user_id: userId,
        user_email: userEmail,
        resource_type: 'tenant',
        resource_id: pendingDeletion.tenant,
        workflow_id: workflowId,
        status: 'pending',
        details: JSON.stringify({
          source: 'ninemindsreporting_extension',
          reason: reason || 'Manual rollback',
        }),
      });

    // Send rollback signal
    const signalResult = await rollbackTenantDeletion(
      workflowId,
      reason || 'Manual rollback',
      userId
    );

    if (!signalResult.available) {
      return NextResponse.json({
        success: false,
        error: signalResult.error || 'Temporal workflow client not available',
      }, { status: 503 });
    }

    if (!signalResult.success) {
      return NextResponse.json({
        success: false,
        error: signalResult.error || 'Failed to send rollback signal',
      }, { status: 500 });
    }

    // LOG: Action completed
    observabilityLogger.info('Rollback tenant deletion completed', {
      event_type: 'tenant_management_action_completed',
      action: 'rollback_tenant_deletion',
      tenant_id: pendingDeletion.tenant,
      workflow_id: workflowId,
      duration_ms: Date.now() - startTime,
    });

    return NextResponse.json({
      success: true,
      workflowId,
      message: 'Deletion rolled back. Users will be reactivated and the Canceled tag will be removed.',
    });
  } catch (error) {
    const routeError = tenantManagementRouteError(error, 'Failed to roll back tenant deletion.');

    observabilityLogger.error('Rollback tenant deletion failed', error, {
      event_type: 'tenant_management_action_failed',
      action: 'rollback_tenant_deletion',
    });

    return NextResponse.json({
      success: false,
      error: routeError.error,
    }, { status: routeError.status });
  }
}
