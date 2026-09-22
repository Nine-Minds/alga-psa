import { NextRequest, NextResponse } from 'next/server';
import { tenantDb } from '@alga-psa/db';
import { getAdminConnection } from '@alga-psa/db/admin';
import { getTenantDeletionState } from '@ee/lib/tenant-management/workflowClient';
import { tenantManagementRouteError } from '../tenantManagementRouteErrors';
import { assertMasterTenantAccess } from '@ee/lib/auth/masterTenantAccess';

const MASTER_BILLING_TENANT_ID = process.env.MASTER_BILLING_TENANT_ID;

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

    await assertMasterTenantAccess(req);

    const { searchParams } = new URL(req.url);
    const statusFilter = searchParams.get('status');
    const includeDeleted = searchParams.get('includeDeleted') === 'true';

    const knex = await getAdminConnection();

    const deletionDb = tenantDb(knex, '__tenant_deletion_admin_listing__');
    let query = deletionDb
      .unscoped('pending_tenant_deletions as pd', 'tenant deletion admin listing spans all pending deletion rows');
    deletionDb.tenantJoin(query, 'tenants as t', 'pd.tenant', 't.tenant', { type: 'left' });
    query = query
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
    const routeError = tenantManagementRouteError(error, 'Failed to load pending tenant deletions.');
    console.error('Error fetching pending deletions:', error);

    return NextResponse.json({
      success: false,
      error: routeError.error,
    }, { status: routeError.status });
  }
}
