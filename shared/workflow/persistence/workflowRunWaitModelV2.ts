import { Knex } from 'knex';

export type WorkflowRunWaitRecord = {
  wait_id: string;
  run_id: string;
  // uuid Citus distribution column (backfilled from the parent run).
  tenant?: string | null;
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

  update: async (knex: Knex, waitId: string, data: Partial<WorkflowRunWaitRecord>, tenant?: string | null): Promise<WorkflowRunWaitRecord> => {
    const query = knex<WorkflowRunWaitRecord>('workflow_run_waits').where({ wait_id: waitId });
    if (tenant) query.andWhere({ tenant });
    const [record] = await query
      .update({
        ...data
      })
      .returning('*');
    return record;
  },

  resolveIfWaiting: async (knex: Knex, waitId: string, data: Partial<WorkflowRunWaitRecord>, tenant?: string | null): Promise<WorkflowRunWaitRecord | null> => {
    const query = knex<WorkflowRunWaitRecord>('workflow_run_waits').where({ wait_id: waitId, status: 'WAITING' });
    if (tenant) query.andWhere({ tenant });
    const [record] = await query
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
    const query = knex<WorkflowRunWaitRecord>('workflow_run_waits')
      .whereIn('wait_type', waitTypes)
      .where('event_name', eventName)
      .where('key', key)
      .where('status', 'WAITING')
      .orderBy('created_at', 'asc');

    // The wait carries its own (colocated) tenant column now, so filter directly
    // instead of joining workflow_runs.
    if (tenantId) {
      query.where('tenant', tenantId);
    }

    const record = await query.first();
    return record || null;
  },

  listEventWaitCandidates: async (
    knex: Knex,
    eventName: string,
    key: string,
    tenantId?: string | null,
    waitTypes: string[] = ['event']
  ): Promise<WorkflowRunWaitRecord[]> => {
    const query = knex<WorkflowRunWaitRecord>('workflow_run_waits')
      .whereIn('wait_type', waitTypes)
      .where('event_name', eventName)
      .where('key', key)
      .where('status', 'WAITING')
      .orderBy('created_at', 'asc');

    if (tenantId) {
      query.where('tenant', tenantId);
    }

    return query;
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
  },

  listDueTimeWaits: async (knex: Knex): Promise<WorkflowRunWaitRecord[]> => {
    return knex<WorkflowRunWaitRecord>('workflow_run_waits')
      .where({
        wait_type: 'time',
        status: 'WAITING'
      })
      .whereNotNull('timeout_at')
      .andWhere('timeout_at', '<=', knex.fn.now());
  },

  listByRun: async (knex: Knex, runId: string, tenant?: string | null): Promise<WorkflowRunWaitRecord[]> => {
    const query = knex<WorkflowRunWaitRecord>('workflow_run_waits').where({ run_id: runId });
    if (tenant) query.andWhere({ tenant });
    return query.orderBy('created_at', 'asc');
  }
};

export default WorkflowRunWaitModelV2;
