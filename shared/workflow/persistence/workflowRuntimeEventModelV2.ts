import { Knex } from 'knex';

export type WorkflowRuntimeEventRecord = {
  event_id: string;
  tenant_id?: string | null;
  event_name: string;
  correlation_key?: string | null;
  payload?: Record<string, unknown> | null;
  created_at: string;
  processed_at?: string | null;
};

const WorkflowRuntimeEventModelV2 = {
  create: async (knex: Knex, data: Partial<WorkflowRuntimeEventRecord>): Promise<WorkflowRuntimeEventRecord> => {
    const [record] = await knex<WorkflowRuntimeEventRecord>('workflow_runtime_events')
      .insert({
        ...data,
        created_at: data.created_at ?? new Date().toISOString()
      })
      .returning('*');
    return record;
  },

  list: async (knex: Knex): Promise<WorkflowRuntimeEventRecord[]> => {
    return knex<WorkflowRuntimeEventRecord>('workflow_runtime_events')
      .orderBy('created_at', 'desc');
  }
};

export default WorkflowRuntimeEventModelV2;
