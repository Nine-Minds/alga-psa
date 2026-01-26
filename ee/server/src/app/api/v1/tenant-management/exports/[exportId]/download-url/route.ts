import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/getSession';
import { getAdminConnection } from '@alga-psa/db/admin';
import { ApiKeyServiceForApi } from '@/lib/services/apiKeyServiceForApi';
import { getExportDownloadUrl } from '@ee/lib/tenant-management/tenant-export';

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

interface RouteContext {
  params: Promise<{ exportId: string }>;
}

/**
 * POST /api/v1/tenant-management/exports/[exportId]/download-url
 *
 * Generate a fresh presigned download URL for an existing export.
 * Body: { tenantId: string, expiresIn?: number }
 * Requires master tenant authorization.
 */
export async function POST(req: NextRequest, context: RouteContext) {
  try {
    if (!MASTER_BILLING_TENANT_ID) {
      return NextResponse.json({ success: false, error: 'MASTER_BILLING_TENANT_ID not configured' }, { status: 500 });
    }

    const { exportId } = await context.params;

    if (!exportId) {
      return NextResponse.json({ success: false, error: 'exportId is required' }, { status: 400 });
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

    const body = await req.json();
    const { tenantId, expiresIn } = body;

    if (!tenantId) {
      return NextResponse.json({ success: false, error: 'tenantId is required in request body' }, { status: 400 });
    }

    // Verify target tenant exists
    const knex = await getAdminConnection();
    const targetTenant = await knex('tenants').where({ tenant: tenantId }).first();
    if (!targetTenant) {
      return NextResponse.json({ success: false, error: 'Tenant not found' }, { status: 404 });
    }

    // Generate fresh download URL
    const urlResult = await getExportDownloadUrl({
      tenantId,
      exportId,
      expiresIn: expiresIn || 3600, // Default 1 hour
    });

    if (!urlResult.success) {
      return NextResponse.json({
        success: false,
        error: urlResult.error || 'Failed to generate download URL',
      }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      exportId,
      tenantId,
      downloadUrl: urlResult.downloadUrl,
      expiresAt: urlResult.expiresAt,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    return NextResponse.json({
      success: false,
      error: errorMessage,
    }, { status: 500 });
  }
}
