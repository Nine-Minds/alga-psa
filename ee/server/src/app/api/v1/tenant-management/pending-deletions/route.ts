import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/getSession';
import { getAdminConnection } from '@alga-psa/shared/db/admin';
import { getTenantDeletionState } from '@ee/lib/tenant-management/workflowClient';
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
 * GET /api/v1/tenant-management/pending-deletions
 *
 * List all pending tenant deletions.
 * Requires master tenant authorization.
 *
 * Query params:
 * - status: Filter by status (optional)
 * - includeDeleted: Include deleted records (default: false)
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
          console.warn('[tenant-management/pending-deletions] Invalid API key');
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
    const statusFilter = searchParams.get('status');
    const includeDeleted = searchParams.get('includeDeleted') === 'true';

    const knex = await getAdminConnection();

    let query = knex('pending_tenant_deletions as pd')
      .leftJoin('tenants as t', 'pd.tenant', 't.tenant')
      .select([
        'pd.deletion_id',
        'pd.tenant',
        't.client_name as tenant_name',
        'pd.trigger_source',
        'pd.canceled_at',
        'pd.scheduled_deletion_date',
        'pd.workflow_id',
        'pd.workflow_run_id',
        'pd.status',
        'pd.stats_snapshot',
        'pd.confirmation_type',
        'pd.confirmed_by',
        'pd.confirmed_at',
        'pd.deletion_scheduled_for',
        'pd.deleted_at',
        'pd.rollback_reason',
        'pd.rolled_back_by',
        'pd.rolled_back_at',
        'pd.error',
        'pd.created_at',
        'pd.updated_at',
      ]);

    if (statusFilter) {
      query = query.where('pd.status', statusFilter);
    } else if (!includeDeleted) {
      // By default, exclude deleted and rolled_back records
      query = query.whereNotIn('pd.status', ['deleted', 'rolled_back']);
    }

    const pendingDeletions = await query.orderBy('pd.scheduled_deletion_date', 'asc');

    // Enrich with days remaining and live workflow state if available
    const enrichedDeletions = await Promise.all(
      pendingDeletions.map(async (deletion: any) => {
        // Parse stats snapshot
        let stats = null;
        try {
          stats = deletion.stats_snapshot
            ? (typeof deletion.stats_snapshot === 'string'
              ? JSON.parse(deletion.stats_snapshot)
              : deletion.stats_snapshot)
            : null;
        } catch {
          // Ignore parse errors
        }

        // Calculate days remaining
        let daysRemaining: number | null = null;
        if (deletion.deletion_scheduled_for) {
          daysRemaining = Math.ceil(
            (new Date(deletion.deletion_scheduled_for).getTime() - Date.now()) / (1000 * 60 * 60 * 24)
          );
        } else if (deletion.scheduled_deletion_date && !['deleted', 'rolled_back'].includes(deletion.status)) {
          daysRemaining = Math.ceil(
            (new Date(deletion.scheduled_deletion_date).getTime() - Date.now()) / (1000 * 60 * 60 * 24)
          );
        }

        // Try to get live workflow state for active workflows
        let liveState: { step: string; status: string } | null = null;
        if (!['deleted', 'rolled_back', 'failed'].includes(deletion.status) && deletion.workflow_id) {
          try {
            const stateResult = await getTenantDeletionState(deletion.workflow_id);
            if (stateResult.available && stateResult.data) {
              liveState = {
                step: stateResult.data.step,
                status: stateResult.data.status,
              };
            }
          } catch {
            // Ignore errors getting live state
          }
        }

        return {
          ...deletion,
          stats_snapshot: stats,
          days_remaining: daysRemaining,
          live_state: liveState,
        };
      })
    );

    return NextResponse.json({
      success: true,
      data: enrichedDeletions,
      count: enrichedDeletions.length,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('Error fetching pending deletions:', error);

    return NextResponse.json({
      success: false,
      error: errorMessage,
    }, { status: 500 });
  }
}
