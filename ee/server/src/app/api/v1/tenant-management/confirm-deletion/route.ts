import { NextRequest, NextResponse } from 'next/server';
import { tenantDb } from '@alga-psa/db';
import { getAdminConnection } from '@alga-psa/db/admin';
import { confirmTenantDeletion, ConfirmationType } from '@ee/lib/tenant-management/workflowClient';
import { observabilityLogger } from '@/lib/observability/logging';
import { tenantManagementRouteError } from '../tenantManagementRouteErrors';
import { assertMasterTenantAccess } from '@ee/lib/auth/masterTenantAccess';

const MASTER_BILLING_TENANT_ID = process.env.MASTER_BILLING_TENANT_ID;

const VALID_CONFIRMATION_TYPES: ConfirmationType[] = ['immediate', '30_days', '90_days'];

/**
 * POST /api/v1/tenant-management/confirm-deletion
 *
 * Send confirmation signal to a tenant deletion workflow.
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
    const { workflowId, type } = body;

    if (!workflowId) {
      return NextResponse.json({ success: false, error: 'workflowId is required' }, { status: 400 });
    }

    if (!type || !VALID_CONFIRMATION_TYPES.includes(type as ConfirmationType)) {
      return NextResponse.json({
        success: false,
        error: `type must be one of: ${VALID_CONFIRMATION_TYPES.join(', ')}`,
      }, { status: 400 });
    }

    // Verify pending deletion exists
    const knex = await getAdminConnection();
    const auditLogs = tenantDb(knex, MASTER_BILLING_TENANT_ID).table('extension_audit_logs');
    const pendingDeletion = await tenantDb(knex, '__tenant_deletion_confirmation_lookup__')
      .unscoped('pending_tenant_deletions', 'tenant deletion confirmation resolves tenant by workflow id before tenant context exists')
      .where({ workflow_id: workflowId })
      .first();

    if (!pendingDeletion) {
      return NextResponse.json({ success: false, error: 'Pending deletion not found' }, { status: 404 });
    }

    if (pendingDeletion.status === 'deleted') {
      return NextResponse.json({ success: false, error: 'Tenant has already been deleted' }, { status: 400 });
    }

    if (pendingDeletion.status === 'rolled_back') {
      return NextResponse.json({ success: false, error: 'Deletion was rolled back' }, { status: 400 });
    }

    // LOG: Action initiated
    observabilityLogger.info('Confirm tenant deletion initiated', {
      event_type: 'tenant_management_action',
      action: 'confirm_tenant_deletion',
      tenant_id: pendingDeletion.tenant,
      workflow_id: workflowId,
      confirmation_type: type,
      triggered_by: userId,
    });

    // Log to unified extension audit table
    await auditLogs
      .insert({
        tenant: MASTER_BILLING_TENANT_ID,
        event_type: 'tenant.confirm_deletion',
        user_id: userId,
        user_email: userEmail,
        resource_type: 'tenant',
        resource_id: pendingDeletion.tenant,
        workflow_id: workflowId,
        status: 'pending',
        details: JSON.stringify({
          source: 'ninemindsreporting_extension',
          confirmationType: type,
        }),
      });

    // Send confirmation signal
    const signalResult = await confirmTenantDeletion(workflowId, type as ConfirmationType, userId);

    if (!signalResult.available) {
      return NextResponse.json({
        success: false,
        error: signalResult.error || 'Temporal workflow client not available',
      }, { status: 503 });
    }

    if (!signalResult.success) {
      return NextResponse.json({
        success: false,
        error: signalResult.error || 'Failed to send confirmation signal',
      }, { status: 500 });
    }

    // LOG: Action completed
    observabilityLogger.info('Confirm tenant deletion completed', {
      event_type: 'tenant_management_action_completed',
      action: 'confirm_tenant_deletion',
      tenant_id: pendingDeletion.tenant,
      workflow_id: workflowId,
      confirmation_type: type,
      duration_ms: Date.now() - startTime,
    });

    const deletionTimeMessage = {
      immediate: 'immediately',
      '30_days': 'in 30 days',
      '90_days': 'in 90 days',
    }[type as ConfirmationType];

    return NextResponse.json({
      success: true,
      workflowId,
      confirmationType: type,
      message: `Deletion confirmed. Tenant data will be deleted ${deletionTimeMessage}.`,
    });
  } catch (error) {
    const routeError = tenantManagementRouteError(error, 'Failed to confirm tenant deletion.');

    observabilityLogger.error('Confirm tenant deletion failed', error, {
      event_type: 'tenant_management_action_failed',
      action: 'confirm_tenant_deletion',
    });

    return NextResponse.json({
      success: false,
      error: routeError.error,
    }, { status: routeError.status });
  }
}
