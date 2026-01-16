import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/getSession';
import { getAdminConnection } from '@alga-psa/shared/db/admin';
import { observabilityLogger } from '@/lib/observability/logging';
import { ApiKeyServiceForApi } from '@/lib/services/apiKeyServiceForApi';
import {
  startTenantExportWorkflow,
  type TenantExportInput,
} from '@ee/lib/tenant-management/workflowClient';

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
          console.warn('[tenant-management/export-tenant] Invalid API key');
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
    const [auditRecord] = await knex('extension_audit_logs')
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
      await knex('extension_audit_logs')
        .where({ tenant: MASTER_BILLING_TENANT_ID, log_id: auditRecord.log_id })
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
      await knex('extension_audit_logs')
        .where({ tenant: MASTER_BILLING_TENANT_ID, log_id: auditRecord.log_id })
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
      await knex('extension_audit_logs')
        .where({ tenant: MASTER_BILLING_TENANT_ID, log_id: auditRecord.log_id })
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
    await knex('extension_audit_logs')
      .where({ tenant: MASTER_BILLING_TENANT_ID, log_id: auditRecord.log_id })
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
        downloadUrl: exportResult.downloadUrl,
        urlExpiresAt: exportResult.urlExpiresAt,
        tableCount: exportResult.tableCount,
        recordCount: exportResult.recordCount,
        fileSizeBytes: exportResult.fileSizeBytes,
      },
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    observabilityLogger.error('Export tenant data failed', error, {
      event_type: 'tenant_management_action_failed',
      action: 'export_tenant_data',
    });

    return NextResponse.json({
      success: false,
      error: errorMessage,
    }, { status: 500 });
  }
}
