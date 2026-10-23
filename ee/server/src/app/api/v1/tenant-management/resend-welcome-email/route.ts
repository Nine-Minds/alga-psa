import { NextRequest, NextResponse } from 'next/server';
import { tenantDb } from '@alga-psa/db';
import { getAdminConnection } from '@alga-psa/db/admin';
import { startResendWelcomeEmailWorkflow } from '@ee/lib/tenant-management/workflowClient';
import { observabilityLogger } from '@/lib/observability/logging';
import { tenantManagementRouteError } from '../tenantManagementRouteErrors';
import { assertMasterTenantAccess } from '@ee/lib/auth/masterTenantAccess';

const MASTER_BILLING_TENANT_ID = process.env.MASTER_BILLING_TENANT_ID;

export async function POST(req: NextRequest) {
  const startTime = Date.now();

  try {
    if (!MASTER_BILLING_TENANT_ID) {
      return NextResponse.json({ success: false, error: 'MASTER_BILLING_TENANT_ID not configured' }, { status: 500 });
    }

    const { userId, userEmail } = await assertMasterTenantAccess(req);

    const body = await req.json();
    const { tenantId, userId: targetUserId } = body;

    if (!tenantId) {
      return NextResponse.json({ success: false, error: 'tenantId is required' }, { status: 400 });
    }

    // LOG: Action initiated
    observabilityLogger.info('Resend welcome email initiated', {
      event_type: 'tenant_management_action',
      action: 'resend_welcome_email',
      tenant_id: tenantId,
      target_user_id: targetUserId,
      triggered_by: userId,
      triggered_by_email: userEmail,
    });

    // Log to unified extension audit table (pending status)
    const knex = await getAdminConnection();
    const auditLogs = tenantDb(knex, MASTER_BILLING_TENANT_ID).table('extension_audit_logs');
    const [auditRecord] = await auditLogs
      .insert({
        tenant: MASTER_BILLING_TENANT_ID,
        event_type: 'tenant.resend_email',
        user_id: userId,
        user_email: userEmail,
        resource_type: 'user',
        resource_id: targetUserId || 'admin',
        resource_name: tenantId,  // Store target tenant ID
        status: 'pending',
        details: JSON.stringify({ source: 'ninemindsreporting_extension', targetTenantId: tenantId }),
      })
      .returning('log_id');

    // Trigger Temporal workflow
    const clientResult = await startResendWelcomeEmailWorkflow({
      tenantId,
      userId: targetUserId,
      triggeredBy: userId,
      triggeredByEmail: userEmail || '',
    });

    if (!clientResult.available || !clientResult.result) {
      return NextResponse.json({
        success: false,
        error: clientResult.error || 'Temporal workflow client not available',
      }, { status: 503 });
    }

    const { workflowId } = clientResult;

    // Wait for result (short workflow, should complete quickly)
    const workflowResult = await clientResult.result;

    // Update audit record with result
    await auditLogs
      .where({ log_id: auditRecord.log_id })
      .update({
        workflow_id: workflowId,
        status: workflowResult.success ? 'completed' : 'failed',
        error_message: workflowResult.error,
        details: JSON.stringify({
          source: 'ninemindsreporting_extension',
          targetTenantId: tenantId,
          result: workflowResult,
          duration_ms: Date.now() - startTime,
        }),
      });

    // LOG: Action completed
    observabilityLogger.info('Resend welcome email completed', {
      event_type: 'tenant_management_action_completed',
      action: 'resend_welcome_email',
      tenant_id: tenantId,
      workflow_id: workflowId,
      success: workflowResult.success,
      duration_ms: Date.now() - startTime,
    });

    if (workflowResult.success) {
      return NextResponse.json({
        success: true,
        workflowId,
        email: workflowResult.email,
        tenantName: workflowResult.tenantName,
        message: `Welcome email sent to ${workflowResult.email}`,
      });
    } else {
      return NextResponse.json({
        success: false,
        workflowId,
        error: workflowResult.error,
      }, { status: 500 });
    }
  } catch (error) {
    const routeError = tenantManagementRouteError(error, 'Failed to resend welcome email.');

    observabilityLogger.error('Resend welcome email failed', error, {
      event_type: 'tenant_management_action_failed',
      action: 'resend_welcome_email',
    });

    return NextResponse.json({
      success: false,
      error: routeError.error,
    }, { status: routeError.status });
  }
}
