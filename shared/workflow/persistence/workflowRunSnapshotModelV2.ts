import { Knex } from 'knex';

export type WorkflowRunSnapshotRecord = {
  snapshot_id: string;
  run_id: string;
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

  listByRun: async (knex: Knex, runId: string): Promise<WorkflowRunSnapshotRecord[]> => {
    return knex<WorkflowRunSnapshotRecord>('workflow_run_snapshots')
      .where({ run_id: runId })
      .orderBy('created_at', 'asc');
  }
};

export default WorkflowRunSnapshotModelV2;
