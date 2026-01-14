import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/getSession';
import { getAdminConnection } from '@alga-psa/shared/db/admin';
import { startTenantDeletionWorkflow } from '@ee/lib/tenant-management/workflowClient';
import { observabilityLogger } from '@/lib/observability/logging';
import { ApiKeyServiceForApi } from '@/lib/services/apiKeyServiceForApi';

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
      // Check for API key auth (used by extension uiProxy)
      const apiKey = req.headers.get('x-api-key');
      if (apiKey) {
        const keyRecord = await ApiKeyServiceForApi.validateApiKeyAnyTenant(apiKey);
        if (keyRecord) {
          if (keyRecord.tenant === MASTER_BILLING_TENANT_ID) {
            const headerUserId = req.headers.get('x-user-id');
            const headerUserEmail = req.headers.get('x-user-email');
            const extensionId = req.headers.get('x-alga-extension');

            userTenant = MASTER_BILLING_TENANT_ID;
            userId = headerUserId || (extensionId ? `extension:${extensionId}` : keyRecord.user_id);
            userEmail = headerUserEmail || undefined;
          } else {
            return NextResponse.json({ success: false, error: 'API key not authorized for tenant management' }, { status: 403 });
          }
        } else {
          console.warn('[tenant-management/start-deletion] Invalid API key');
          return NextResponse.json({ success: false, error: 'Invalid API key' }, { status: 401 });
        }
      } else {
        // Fall back to session auth
        const session = await getSession();

        if (!session?.user) {
          return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
        }

        const user = session.user as any;
        userTenant = user.tenant;
        userId = user.user_id;
        userEmail = user.email;
      }
    }

    // Verify user is from master tenant
    if (userTenant !== MASTER_BILLING_TENANT_ID) {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
    }

    const body = await req.json();
    const { tenantId, reason } = body;

    if (!tenantId) {
      return NextResponse.json({ success: false, error: 'tenantId is required' }, { status: 400 });
    }

    // Verify target tenant exists
    const knex = await getAdminConnection();
    const targetTenant = await knex('tenants').where({ tenant: tenantId }).first();
    if (!targetTenant) {
      return NextResponse.json({ success: false, error: 'Tenant not found' }, { status: 404 });
    }

    // Check for existing pending deletion
    const existingDeletion = await knex('pending_tenant_deletions')
      .where({ tenant: tenantId })
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
    const [auditRecord] = await knex('extension_audit_logs')
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
      await knex('extension_audit_logs')
        .where({ tenant: MASTER_BILLING_TENANT_ID, log_id: auditRecord.log_id })
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
    await knex('extension_audit_logs')
      .where({ tenant: MASTER_BILLING_TENANT_ID, log_id: auditRecord.log_id })
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
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    observabilityLogger.error('Start tenant deletion failed', error, {
      event_type: 'tenant_management_action_failed',
      action: 'start_tenant_deletion',
    });

    return NextResponse.json({
      success: false,
      error: errorMessage,
    }, { status: 500 });
  }
}
