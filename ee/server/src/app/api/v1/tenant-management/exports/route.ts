import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/getSession';
import { getAdminConnection } from '@alga-psa/db/admin';
import { ApiKeyServiceForApi } from '@/lib/services/apiKeyServiceForApi';
import { headObject } from '@ee/lib/storage/s3-client';

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
 * GET /api/v1/tenant-management/exports
 *
 * List all data exports for a tenant.
 * Query params: tenantId (required)
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

    // Get tenantId from query params
    const { searchParams } = new URL(req.url);
    const tenantId = searchParams.get('tenantId');

    if (!tenantId) {
      return NextResponse.json({ success: false, error: 'tenantId query parameter is required' }, { status: 400 });
    }

    // Verify target tenant exists
    const knex = await getAdminConnection();
    const targetTenant = await knex('tenants').where({ tenant: tenantId }).first();
    if (!targetTenant) {
      return NextResponse.json({ success: false, error: 'Tenant not found' }, { status: 404 });
    }

    // Find exports from audit logs
    const exportLogs = await knex('extension_audit_logs')
      .where({
        tenant: MASTER_BILLING_TENANT_ID,
        event_type: 'tenant.export_data',
        resource_id: tenantId,
        status: 'completed',
      })
      .orderBy('created_at', 'desc')
      .select('*');

    // Parse export details and check S3 availability
    const exports = await Promise.all(
      exportLogs.map(async (log) => {
        let details: any = {};
        try {
          details = typeof log.details === 'string' ? JSON.parse(log.details) : log.details;
        } catch {
          details = {};
        }

        const exportId = details.exportId;
        const s3Key = exportId ? `tenant-exports/${tenantId}/${exportId}.json` : null;

        // Check if export still exists in S3
        let existsInS3 = false;
        if (s3Key) {
          try {
            const headResult = await headObject(s3Key);
            existsInS3 = headResult.exists;
          } catch {
            existsInS3 = false;
          }
        }

        return {
          exportId: details.exportId,
          tenantId,
          tenantName: targetTenant.client_name,
          exportedAt: log.created_at,
          requestedBy: log.user_id,
          requestedByEmail: log.user_email,
          reason: details.reason,
          tableCount: details.tableCount,
          recordCount: details.recordCount,
          fileSizeBytes: details.fileSizeBytes,
          existsInS3,
        };
      })
    );

    // Filter to only exports that exist in S3
    const availableExports = exports.filter((e) => e.existsInS3 && e.exportId);

    return NextResponse.json({
      success: true,
      tenantId,
      tenantName: targetTenant.client_name,
      exports: availableExports,
      totalCount: availableExports.length,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    return NextResponse.json({
      success: false,
      error: errorMessage,
    }, { status: 500 });
  }
}
