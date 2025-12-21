import { Knex } from 'knex';

export type WorkflowRunRecord = {
  run_id: string;
  workflow_id: string;
  workflow_version: number;
  tenant_id?: string | null;
  status: string;
  node_path?: string | null;
  input_json?: Record<string, unknown> | null;
  resume_event_payload?: Record<string, unknown> | null;
  resume_event_name?: string | null;
  resume_error?: Record<string, unknown> | null;
  error_json?: Record<string, unknown> | null;
  lease_owner?: string | null;
  lease_expires_at?: string | null;
  started_at: string;
  completed_at?: string | null;
  updated_at: string;
};

const WorkflowRunModelV2 = {
  create: async (knex: Knex, data: Partial<WorkflowRunRecord>): Promise<WorkflowRunRecord> => {
    const [record] = await knex<WorkflowRunRecord>('workflow_runs')
      .insert({
        ...data,
        started_at: data.started_at ?? new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .returning('*');
    return record;
  },

  update: async (knex: Knex, runId: string, data: Partial<WorkflowRunRecord>): Promise<WorkflowRunRecord> => {
    const [record] = await knex<WorkflowRunRecord>('workflow_runs')
      .where({ run_id: runId })
      .update({
        ...data,
        updated_at: new Date().toISOString()
      })
      .returning('*');
    return record;
  },

  getById: async (knex: Knex, runId: string): Promise<WorkflowRunRecord | null> => {
    const record = await knex<WorkflowRunRecord>('workflow_runs')
      .where({ run_id: runId })
      .first();
    return record || null;
  },

  listByStatus: async (knex: Knex, status: string): Promise<WorkflowRunRecord[]> => {
    return knex<WorkflowRunRecord>('workflow_runs')
      .where({ status })
      .select('*');
  }
};

export default WorkflowRunModelV2;
