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
  payload?: unknown | null;
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

  resolveIfWaiting: async (knex: Knex, waitId: string, data: Partial<WorkflowRunWaitRecord>): Promise<WorkflowRunWaitRecord | null> => {
    const [record] = await knex<WorkflowRunWaitRecord>('workflow_run_waits')
      .where({ wait_id: waitId, status: 'WAITING' })
      .update({
        ...data
      })
      .returning('*');
    return record || null;
  },

  findEventWait: async (
    knex: Knex,
    eventName: string,
    key: string,
    tenantId?: string | null,
    waitTypes: string[] = ['event']
  ): Promise<WorkflowRunWaitRecord | null> => {
    let query = knex<WorkflowRunWaitRecord>('workflow_run_waits')
      .whereIn('workflow_run_waits.wait_type', waitTypes)
      .where('workflow_run_waits.event_name', eventName)
      .where('workflow_run_waits.key', key)
      .where('workflow_run_waits.status', 'WAITING')
      .orderBy('workflow_run_waits.created_at', 'asc');

    if (tenantId) {
      query = query
        .join('workflow_runs', 'workflow_run_waits.run_id', 'workflow_runs.run_id')
        .where('workflow_runs.tenant_id', tenantId)
        .select('workflow_run_waits.*');
    }

    const record = await query.first();
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
      .whereNotNull('timeout_at')
      .andWhere('timeout_at', '<=', knex.fn.now());
  }
};

export default WorkflowRunWaitModelV2;
