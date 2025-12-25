import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/getSession';
import { getAdminConnection } from '@alga-psa/shared/db/admin';
import { startResendWelcomeEmailWorkflow } from '@ee/lib/tenant-management/workflowClient';
import { observabilityLogger } from '@/lib/observability/logging';

const MASTER_BILLING_TENANT_ID = process.env.MASTER_BILLING_TENANT_ID;

/**
 * Check if this is an internal request from ext-proxy with trusted user info.
 */
function getInternalUserInfo(request: NextRequest): { user_id: string; tenant: string; email?: string } | null {
  const internalRequest = request.headers.get('x-internal-request');
  if (internalRequest !== 'ext-proxy-prefetch') {
    return null;
  }

  const userId = request.headers.get('x-internal-user-id');
  const tenant = request.headers.get('x-internal-user-tenant');
  const email = request.headers.get('x-internal-user-email') || undefined;

  if (!userId || !tenant) {
    return null;
  }

  return { user_id: userId, tenant, email };
}

export async function POST(req: NextRequest) {
  const startTime = Date.now();

  try {
    // Check for internal ext-proxy request first
    const internalUser = getInternalUserInfo(req);
    let userTenant: string;
    let userId: string;
    let userEmail: string | undefined;

    if (internalUser) {
      userTenant = internalUser.tenant;
      userId = internalUser.user_id;
      userEmail = internalUser.email;
    } else {
      const session = await getSession();

      if (!session?.user) {
        return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
      }

      const user = session.user as any;
      userTenant = user.tenant;
      userId = user.user_id;
      userEmail = user.email;
    }

    // Verify user is from master tenant
    if (userTenant !== MASTER_BILLING_TENANT_ID) {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
    }

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
    const [auditRecord] = await knex('extension_audit_logs')
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
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    observabilityLogger.error('Resend welcome email failed', error, {
      event_type: 'tenant_management_action_failed',
      action: 'resend_welcome_email',
    });

    return NextResponse.json({
      success: false,
      error: errorMessage,
    }, { status: 500 });
  }
}
