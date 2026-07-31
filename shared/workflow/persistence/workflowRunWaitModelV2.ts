import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';

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

function workflowRunWaits(
  knex: Knex,
  tenant?: string | null,
): Knex.QueryBuilder<WorkflowRunWaitRecord, WorkflowRunWaitRecord[]> {
  return tenant
    ? tenantDb(knex, tenant).table<WorkflowRunWaitRecord>('workflow_run_waits')
    : tenantDb(knex, '__workflow_run_wait_unscoped__').unscoped<WorkflowRunWaitRecord>(
      'workflow_run_waits',
      'workflow run wait model supports legacy wait_id/event discovery before the tenant is resolved'
    );
}

const WorkflowRunWaitModelV2 = {
  create: async (knex: Knex, data: Partial<WorkflowRunWaitRecord>): Promise<WorkflowRunWaitRecord> => {
    const [record] = await workflowRunWaits(knex, data.tenant)
      .insert({
        ...data,
        created_at: data.created_at ?? new Date().toISOString()
      })
      .returning('*');
    return record;
  },

  update: async (knex: Knex, waitId: string, data: Partial<WorkflowRunWaitRecord>, tenant?: string | null): Promise<WorkflowRunWaitRecord> => {
    const [record] = await workflowRunWaits(knex, tenant)
      .where({ wait_id: waitId })
      .update({
        ...data
      })
      .returning('*');
    return record;
  },

  resolveIfWaiting: async (knex: Knex, waitId: string, data: Partial<WorkflowRunWaitRecord>, tenant?: string | null): Promise<WorkflowRunWaitRecord | null> => {
    const [record] = await workflowRunWaits(knex, tenant)
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
    const query = workflowRunWaits(knex, tenantId)
      .whereIn('wait_type', waitTypes)
      .where('event_name', eventName)
      .where('key', key)
      .where('status', 'WAITING')
      .orderBy('created_at', 'asc');

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
    return workflowRunWaits(knex, tenantId)
      .whereIn('wait_type', waitTypes)
      .where('event_name', eventName)
      .where('key', key)
      .where('status', 'WAITING')
      .orderBy('created_at', 'asc');
  },

  listDueRetries: async (knex: Knex): Promise<WorkflowRunWaitRecord[]> => {
    return tenantDb(knex, '__workflow_due_retry_waits_unscoped__')
      .unscoped<WorkflowRunWaitRecord>(
        'workflow_run_waits',
        'workflow retry wait scheduler intentionally scans due waits across tenants'
      )
      .where({
        wait_type: 'retry',
        status: 'WAITING'
      })
      .andWhere('timeout_at', '<=', knex.fn.now());
  },

  listDueTimeouts: async (knex: Knex): Promise<WorkflowRunWaitRecord[]> => {
    return tenantDb(knex, '__workflow_due_timeout_waits_unscoped__')
      .unscoped<WorkflowRunWaitRecord>(
        'workflow_run_waits',
        'workflow event timeout scheduler intentionally scans due waits across tenants'
      )
      .where({
        wait_type: 'event',
        status: 'WAITING'
      })
      .whereNotNull('timeout_at')
      .andWhere('timeout_at', '<=', knex.fn.now());
  },

  listDueTimeWaits: async (knex: Knex): Promise<WorkflowRunWaitRecord[]> => {
    return tenantDb(knex, '__workflow_due_time_waits_unscoped__')
      .unscoped<WorkflowRunWaitRecord>(
        'workflow_run_waits',
        'workflow time wait scheduler intentionally scans due waits across tenants'
      )
      .where({
        wait_type: 'time',
        status: 'WAITING'
      })
      .whereNotNull('timeout_at')
      .andWhere('timeout_at', '<=', knex.fn.now());
  },

  listByRun: async (knex: Knex, runId: string, tenant?: string | null): Promise<WorkflowRunWaitRecord[]> => {
    return workflowRunWaits(knex, tenant)
      .where({ run_id: runId })
      .orderBy('created_at', 'asc');
  }
};

export default WorkflowRunWaitModelV2;
