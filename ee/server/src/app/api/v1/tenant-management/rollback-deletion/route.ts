import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/getSession';
import { getAdminConnection } from '@alga-psa/shared/db/admin';
import { rollbackTenantDeletion } from '@ee/lib/tenant-management/workflowClient';
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
          console.warn('[tenant-management/rollback-deletion] Invalid API key');
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
    const { workflowId, reason } = body;

    if (!workflowId) {
      return NextResponse.json({ success: false, error: 'workflowId is required' }, { status: 400 });
    }

    // Verify pending deletion exists
    const knex = await getAdminConnection();
    const pendingDeletion = await knex('pending_tenant_deletions')
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
    await knex('extension_audit_logs')
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
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    observabilityLogger.error('Rollback tenant deletion failed', error, {
      event_type: 'tenant_management_action_failed',
      action: 'rollback_tenant_deletion',
    });

    return NextResponse.json({
      success: false,
      error: errorMessage,
    }, { status: 500 });
  }
}
