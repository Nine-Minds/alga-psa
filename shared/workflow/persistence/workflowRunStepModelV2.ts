import { Knex } from 'knex';

export type WorkflowRunStepRecord = {
  step_id: string;
  run_id: string;
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

  update: async (knex: Knex, stepId: string, data: Partial<WorkflowRunStepRecord>): Promise<WorkflowRunStepRecord> => {
    const [record] = await knex<WorkflowRunStepRecord>('workflow_run_steps')
      .where({ step_id: stepId })
      .update({
        ...data
      })
      .returning('*');
    return record;
  },

  getLatestByRunAndPath: async (knex: Knex, runId: string, stepPath: string): Promise<WorkflowRunStepRecord | null> => {
    const record = await knex<WorkflowRunStepRecord>('workflow_run_steps')
      .where({ run_id: runId, step_path: stepPath })
      .orderBy('started_at', 'desc')
      .first();
    return record || null;
  },

  listByRun: async (knex: Knex, runId: string): Promise<WorkflowRunStepRecord[]> => {
    return knex<WorkflowRunStepRecord>('workflow_run_steps')
      .where({ run_id: runId })
      .orderBy('started_at', 'asc');
  }
};

export default WorkflowRunStepModelV2;
