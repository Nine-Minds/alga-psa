import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/getSession';
import { ApiKeyServiceForApi } from '@/lib/services/apiKeyServiceForApi';
import { TenantWorkflowClient } from '@ee/temporal-workflows/client';

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
 * GET /api/v1/tenant-management/export-status?workflowId=xxx
 *
 * Get the status of a tenant export workflow.
 * Requires master tenant authorization.
 */
export async function GET(req: NextRequest) {
  try {
    if (!MASTER_BILLING_TENANT_ID) {
      return NextResponse.json({ success: false, error: 'MASTER_BILLING_TENANT_ID not configured' }, { status: 500 });
    }

    // Check for internal ext-proxy request first
    const internalUser = getInternalUserInfo(req);
    let userTenant: string;

    if (internalUser) {
      userTenant = internalUser.tenant;
    } else {
      // Check for API key auth (used by extension uiProxy)
      const apiKey = req.headers.get('x-api-key');
      if (apiKey) {
        const keyRecord = await ApiKeyServiceForApi.validateApiKeyAnyTenant(apiKey);
        if (keyRecord) {
          if (keyRecord.tenant === MASTER_BILLING_TENANT_ID) {
            userTenant = MASTER_BILLING_TENANT_ID;
          } else {
            return NextResponse.json({ success: false, error: 'API key not authorized for tenant management' }, { status: 403 });
          }
        } else {
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
      }
    }

    // Verify user is from master tenant
    if (userTenant !== MASTER_BILLING_TENANT_ID) {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const workflowId = searchParams.get('workflowId');

    if (!workflowId) {
      return NextResponse.json({ success: false, error: 'workflowId is required' }, { status: 400 });
    }

    // Query the workflow state
    const client = await TenantWorkflowClient.create();

    try {
      const state = await client.getTenantExportState(workflowId);

      return NextResponse.json({
        success: true,
        data: {
          workflowId,
          status: state.status,
          step: state.step,
          exportId: state.exportId,
          tenantId: state.tenantId,
          tenantName: state.tenantName,
          progress: state.progress,
          currentTable: state.currentTable,
          s3Key: state.s3Key,
          downloadUrl: state.downloadUrl,
          urlExpiresAt: state.urlExpiresAt,
          fileSizeBytes: state.fileSizeBytes,
          tableCount: state.tableCount,
          recordCount: state.recordCount,
          error: state.error,
          startedAt: state.startedAt,
          completedAt: state.completedAt,
        },
      });
    } catch (error) {
      // Check if workflow doesn't exist or completed
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      // If the workflow is not found, it might have completed - try to get the result
      if (errorMessage.includes('not found') || errorMessage.includes('workflow not found')) {
        return NextResponse.json({
          success: false,
          error: 'Workflow not found. It may have completed or never existed.',
        }, { status: 404 });
      }

      throw error;
    } finally {
      await client.close();
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    return NextResponse.json({
      success: false,
      error: errorMessage,
    }, { status: 500 });
  }
}
