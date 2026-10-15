import { NextRequest, NextResponse } from 'next/server';
import { tenantDb } from '@alga-psa/db';
import { getAdminConnection } from '@alga-psa/db/admin';
import { headObject, getBucket } from '@ee/lib/storage/s3-client';
import { tenantManagementRouteError } from '../tenantManagementRouteErrors';
import { assertMasterTenantAccess } from '@ee/lib/auth/masterTenantAccess';

const MASTER_BILLING_TENANT_ID = process.env.MASTER_BILLING_TENANT_ID;

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

    await assertMasterTenantAccess(req);

    // Get tenantId from query params
    const { searchParams } = new URL(req.url);
    const tenantId = searchParams.get('tenantId');

    if (!tenantId) {
      return NextResponse.json({ success: false, error: 'tenantId query parameter is required' }, { status: 400 });
    }

    // Verify target tenant exists
    const knex = await getAdminConnection();
    const auditLogs = tenantDb(knex, MASTER_BILLING_TENANT_ID).table('extension_audit_logs');
    const targetTenant = await tenantDb(knex, tenantId).table('tenants').first();
    if (!targetTenant) {
      return NextResponse.json({ success: false, error: 'Tenant not found' }, { status: 404 });
    }

    // Find exports from audit logs
    const exportLogs = await auditLogs
      .where({
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
          // MinIO location for direct access
          bucket: existsInS3 ? getBucket() : undefined,
          s3Key: existsInS3 ? s3Key : undefined,
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
    const routeError = tenantManagementRouteError(error, 'Failed to load tenant exports.');

    return NextResponse.json({
      success: false,
      error: routeError.error,
    }, { status: routeError.status });
  }
}
