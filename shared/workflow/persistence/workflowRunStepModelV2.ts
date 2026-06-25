import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';

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

function workflowRunSteps(
  knex: Knex,
  tenant?: string | null,
): Knex.QueryBuilder<WorkflowRunStepRecord, WorkflowRunStepRecord[]> {
  return tenant
    ? tenantDb(knex, tenant).table<WorkflowRunStepRecord>('workflow_run_steps')
    : knex<WorkflowRunStepRecord>('workflow_run_steps');
}

const WorkflowRunStepModelV2 = {
  create: async (knex: Knex, data: Partial<WorkflowRunStepRecord>): Promise<WorkflowRunStepRecord> => {
    const [record] = await workflowRunSteps(knex, data.tenant)
      .insert({
        ...data,
        started_at: data.started_at ?? new Date().toISOString()
      })
      .returning('*');
    return record;
  },

  update: async (knex: Knex, stepId: string, data: Partial<WorkflowRunStepRecord>, tenant?: string | null): Promise<WorkflowRunStepRecord> => {
    const [record] = await workflowRunSteps(knex, tenant)
      .where({ step_id: stepId })
      .update({
        ...data
      })
      .returning('*');
    return record;
  },

  getLatestByRunAndPath: async (knex: Knex, runId: string, stepPath: string, tenant?: string | null): Promise<WorkflowRunStepRecord | null> => {
    const record = await workflowRunSteps(knex, tenant)
      .where({ run_id: runId, step_path: stepPath })
      .orderBy('started_at', 'desc')
      .first();
    return record || null;
  },

  listByRun: async (knex: Knex, runId: string, tenant?: string | null): Promise<WorkflowRunStepRecord[]> => {
    return workflowRunSteps(knex, tenant)
      .where({ run_id: runId })
      .orderBy('started_at', 'asc');
  }
};

export default WorkflowRunStepModelV2;
