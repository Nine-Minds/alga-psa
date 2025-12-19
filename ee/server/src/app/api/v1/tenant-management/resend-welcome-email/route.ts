import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { options } from '@/app/api/auth/[...nextauth]/options';
import { getAdminConnection } from '@alga-psa/shared/db/admin';
import { TenantWorkflowClient } from '../../../../../../../temporal-workflows/src/client';
import { observabilityLogger } from '@/lib/observability/logging';

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

export async function POST(req: NextRequest) {
  const startTime = Date.now();

  try {
    const session = await getServerSession(options);

    if (!session?.user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401, headers: corsHeaders });
    }

    // Verify user is from master tenant
    if (session.user.tenant !== MASTER_BILLING_TENANT_ID) {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403, headers: corsHeaders });
    }

    const body = await req.json();
    const { tenantId, userId } = body;

    if (!tenantId) {
      return NextResponse.json({ success: false, error: 'tenantId is required' }, { status: 400, headers: corsHeaders });
    }

    // LOG: Action initiated
    observabilityLogger.info('Resend welcome email initiated', {
      event_type: 'tenant_management_action',
      action: 'resend_welcome_email',
      tenant_id: tenantId,
      target_user_id: userId,
      triggered_by: session.user.user_id,
      triggered_by_email: session.user.email,
    });

    // Log to unified extension audit table (pending status)
    const knex = await getAdminConnection();
    const [auditRecord] = await knex('extension_audit_logs')
      .insert({
        tenant: MASTER_BILLING_TENANT_ID,
        event_type: 'tenant.resend_email',
        user_id: session.user.user_id,
        user_email: session.user.email,
        resource_type: 'user',
        resource_id: userId || 'admin',
        resource_name: tenantId,  // Store target tenant ID
        status: 'pending',
        details: JSON.stringify({ source: 'ninemindsreporting_extension', targetTenantId: tenantId }),
      })
      .returning('log_id');

    // Trigger Temporal workflow
    const client = await TenantWorkflowClient.create();
    const { workflowId, result } = await client.startResendWelcomeEmail({
      tenantId,
      userId,
      triggeredBy: session.user.user_id,
      triggeredByEmail: session.user.email,
    });

    // Wait for result (short workflow, should complete quickly)
    const workflowResult = await result;

    // Update audit record with result
    await knex('extension_audit_logs')
      .where({ tenant: MASTER_BILLING_TENANT_ID, log_id: auditRecord.log_id })
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

    // Close the client connection
    await client.close();

    if (workflowResult.success) {
      return NextResponse.json({
        success: true,
        workflowId,
        email: workflowResult.email,
        tenantName: workflowResult.tenantName,
        message: `Welcome email sent to ${workflowResult.email}`,
      }, { headers: corsHeaders });
    } else {
      return NextResponse.json({
        success: false,
        workflowId,
        error: workflowResult.error,
      }, { status: 500, headers: corsHeaders });
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    observabilityLogger.error('Resend welcome email failed', error, {
      event_type: 'tenant_management_action_failed',
      action: 'resend_welcome_email',
    });

    return NextResponse.json({
      success: false,
      error: errorMessage,
    }, { status: 500, headers: corsHeaders });
  }
}
