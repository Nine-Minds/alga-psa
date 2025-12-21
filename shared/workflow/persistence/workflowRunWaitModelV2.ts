import { Knex } from 'knex';

export type WorkflowRunWaitRecord = {
  wait_id: string;
  run_id: string;
  step_path: string;
  wait_type: string;
  key?: string | null;
  event_name?: string | null;
  timeout_at?: string | null;
  status: string;
  payload?: Record<string, unknown> | null;
  created_at: string;
  resolved_at?: string | null;
};

const WorkflowRunWaitModelV2 = {
  create: async (knex: Knex, data: Partial<WorkflowRunWaitRecord>): Promise<WorkflowRunWaitRecord> => {
    const [record] = await knex<WorkflowRunWaitRecord>('workflow_run_waits')
      .insert({
        ...data,
        created_at: data.created_at ?? new Date().toISOString()
      })
      .returning('*');
    return record;
  },

  update: async (knex: Knex, waitId: string, data: Partial<WorkflowRunWaitRecord>): Promise<WorkflowRunWaitRecord> => {
    const [record] = await knex<WorkflowRunWaitRecord>('workflow_run_waits')
      .where({ wait_id: waitId })
      .update({
        ...data
      })
      .returning('*');
    return record;
  },

  findEventWait: async (knex: Knex, eventName: string, key: string): Promise<WorkflowRunWaitRecord | null> => {
    const record = await knex<WorkflowRunWaitRecord>('workflow_run_waits')
      .where({
        wait_type: 'event',
        event_name: eventName,
        key,
        status: 'WAITING'
      })
      .orderBy('created_at', 'asc')
      .first();
    return record || null;
  },

  listDueRetries: async (knex: Knex): Promise<WorkflowRunWaitRecord[]> => {
    return knex<WorkflowRunWaitRecord>('workflow_run_waits')
      .where({
        wait_type: 'retry',
        status: 'WAITING'
      })
      .andWhere('timeout_at', '<=', knex.fn.now());
  },

  listDueTimeouts: async (knex: Knex): Promise<WorkflowRunWaitRecord[]> => {
    return knex<WorkflowRunWaitRecord>('workflow_run_waits')
      .where({
        wait_type: 'event',
        status: 'WAITING'
      })
      .andWhereNotNull('timeout_at')
      .andWhere('timeout_at', '<=', knex.fn.now());
  }
};

export default WorkflowRunWaitModelV2;
