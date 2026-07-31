import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';

export type WorkflowRunSnapshotRecord = {
  snapshot_id: string;
  run_id: string;
  // uuid Citus distribution column (backfilled from the parent run).
  tenant?: string | null;
  step_path: string;
  envelope_json: Record<string, unknown>;
  size_bytes: number;
  created_at: string;
};

function workflowRunSnapshots(
  knex: Knex,
  tenant?: string | null,
): Knex.QueryBuilder<WorkflowRunSnapshotRecord, WorkflowRunSnapshotRecord[]> {
  return tenant
    ? tenantDb(knex, tenant).table<WorkflowRunSnapshotRecord>('workflow_run_snapshots')
    : tenantDb(knex, '__workflow_run_snapshot_unscoped__').unscoped<WorkflowRunSnapshotRecord>(
      'workflow_run_snapshots',
      'workflow run snapshot model supports legacy run_id lookups before the tenant is resolved'
    );
}

const WorkflowRunSnapshotModelV2 = {
  create: async (knex: Knex, data: Partial<WorkflowRunSnapshotRecord>): Promise<WorkflowRunSnapshotRecord> => {
    const [record] = await workflowRunSnapshots(knex, data.tenant)
      .insert({
        ...data,
        created_at: data.created_at ?? new Date().toISOString()
      })
      .returning('*');
    return record;
  },

  listByRun: async (knex: Knex, runId: string, tenant?: string | null): Promise<WorkflowRunSnapshotRecord[]> => {
    return workflowRunSnapshots(knex, tenant)
      .where({ run_id: runId })
      .orderBy('created_at', 'asc');
  }
};

export default WorkflowRunSnapshotModelV2;
