import { Knex } from 'knex';

export type WorkflowRunStepRecord = {
  step_id: string;
  run_id: string;
  // uuid Citus distribution column (backfilled from the parent run).
  tenant?: string | null;
  step_path: string;
  definition_step_id: string;
  status: string;
  attempt: number;
  duration_ms?: number | null;
  error_json?: Record<string, unknown> | null;
  snapshot_id?: string | null;
  started_at: string;
  completed_at?: string | null;
};

const WorkflowRunStepModelV2 = {
  create: async (knex: Knex, data: Partial<WorkflowRunStepRecord>): Promise<WorkflowRunStepRecord> => {
    const [record] = await knex<WorkflowRunStepRecord>('workflow_run_steps')
      .insert({
        ...data,
        started_at: data.started_at ?? new Date().toISOString()
      })
      .returning('*');
    return record;
  },

  update: async (knex: Knex, stepId: string, data: Partial<WorkflowRunStepRecord>, tenant?: string | null): Promise<WorkflowRunStepRecord> => {
    const query = knex<WorkflowRunStepRecord>('workflow_run_steps').where({ step_id: stepId });
    if (tenant) query.andWhere({ tenant });
    const [record] = await query
      .update({
        ...data
      })
      .returning('*');
    return record;
  },

  getLatestByRunAndPath: async (knex: Knex, runId: string, stepPath: string, tenant?: string | null): Promise<WorkflowRunStepRecord | null> => {
    const query = knex<WorkflowRunStepRecord>('workflow_run_steps').where({ run_id: runId, step_path: stepPath });
    if (tenant) query.andWhere({ tenant });
    const record = await query.orderBy('started_at', 'desc').first();
    return record || null;
  },

  listByRun: async (knex: Knex, runId: string, tenant?: string | null): Promise<WorkflowRunStepRecord[]> => {
    const query = knex<WorkflowRunStepRecord>('workflow_run_steps').where({ run_id: runId });
    if (tenant) query.andWhere({ tenant });
    return query.orderBy('started_at', 'asc');
  }
};

export default WorkflowRunStepModelV2;
