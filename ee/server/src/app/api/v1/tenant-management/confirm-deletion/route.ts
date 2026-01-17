import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/getSession';
import { getAdminConnection } from '@alga-psa/db/admin';
import { confirmTenantDeletion, ConfirmationType } from '@ee/lib/tenant-management/workflowClient';
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
          console.warn('[tenant-management/confirm-deletion] Invalid API key');
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
    const pendingDeletion = await knex('pending_tenant_deletions')
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
    await knex('extension_audit_logs')
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
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    observabilityLogger.error('Confirm tenant deletion failed', error, {
      event_type: 'tenant_management_action_failed',
      action: 'confirm_tenant_deletion',
    });

    return NextResponse.json({
      success: false,
      error: errorMessage,
    }, { status: 500 });
  }
}
