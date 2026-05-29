import { Knex } from 'knex';

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

const WorkflowRunSnapshotModelV2 = {
  create: async (knex: Knex, data: Partial<WorkflowRunSnapshotRecord>): Promise<WorkflowRunSnapshotRecord> => {
    const [record] = await knex<WorkflowRunSnapshotRecord>('workflow_run_snapshots')
      .insert({
        ...data,
        created_at: data.created_at ?? new Date().toISOString()
      })
      .returning('*');
    return record;
  },

  listByRun: async (knex: Knex, runId: string, tenant?: string | null): Promise<WorkflowRunSnapshotRecord[]> => {
    const query = knex<WorkflowRunSnapshotRecord>('workflow_run_snapshots').where({ run_id: runId });
    if (tenant) query.andWhere({ tenant });
    return query.orderBy('created_at', 'asc');
  }
};

export default WorkflowRunSnapshotModelV2;
