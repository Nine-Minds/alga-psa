import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';

export type WorkflowRuntimeEventRecord = {
  event_id: string;
  // uuid Citus distribution column. The legacy `tenant_id` column is being phased
  // out (dropped in the cleanup migration) and is not referenced here.
  tenant?: string | null;
  event_name: string;
  correlation_key?: string | null;
  payload?: Record<string, unknown> | null;
  payload_schema_ref?: string | null;
  schema_ref_conflict?: { submission: string; catalog: string } | null;
  created_at: string;
  processed_at?: string | null;
  matched_run_id?: string | null;
  matched_wait_id?: string | null;
  matched_step_path?: string | null;
  error_message?: string | null;
};

function workflowRuntimeEvents(
  knex: Knex,
  tenant?: string | null,
): Knex.QueryBuilder<WorkflowRuntimeEventRecord, WorkflowRuntimeEventRecord[]> {
  return tenant
    ? tenantDb(knex, tenant).table<WorkflowRuntimeEventRecord>('workflow_runtime_events')
    : tenantDb(knex, '__workflow_runtime_event_unscoped__').unscoped<WorkflowRuntimeEventRecord>(
      'workflow_runtime_events',
      'workflow runtime event model supports tenantless event searches and replay/admin discovery'
    );
}

const WorkflowRuntimeEventModelV2 = {
  create: async (knex: Knex, data: Partial<WorkflowRuntimeEventRecord>): Promise<WorkflowRuntimeEventRecord> => {
    const [record] = await workflowRuntimeEvents(knex, data.tenant)
      .insert({
        ...data,
        created_at: data.created_at ?? new Date().toISOString()
      })
      .returning('*');
    return record;
  },

  update: async (knex: Knex, eventId: string, data: Partial<WorkflowRuntimeEventRecord>, tenant?: string | null): Promise<WorkflowRuntimeEventRecord> => {
    const [record] = await workflowRuntimeEvents(knex, tenant)
      .where({ event_id: eventId })
      .update({
        ...data
      })
      .returning('*');
    return record;
  },

  getById: async (knex: Knex, eventId: string, tenant?: string | null): Promise<WorkflowRuntimeEventRecord | null> => {
    const record = await workflowRuntimeEvents(knex, tenant)
      .where({ event_id: eventId })
      .first();
    return record || null;
  },

  list: async (
    knex: Knex,
    options?: {
      tenantId?: string | null;
      eventName?: string;
      correlationKey?: string;
      from?: string;
      to?: string;
      status?: 'matched' | 'unmatched' | 'error';
      limit?: number;
      cursor?: number;
    }
  ): Promise<WorkflowRuntimeEventRecord[]> => {
    const query = workflowRuntimeEvents(knex, options?.tenantId);
    if (options?.eventName) {
      query.where('event_name', options.eventName);
    }
    if (options?.correlationKey) {
      query.where('correlation_key', options.correlationKey);
    }
    if (options?.from) {
      query.where('created_at', '>=', options.from);
    }
    if (options?.to) {
      query.where('created_at', '<=', options.to);
    }
    if (options?.status === 'matched') {
      query.whereNotNull('matched_run_id').whereNull('error_message');
    }
    if (options?.status === 'unmatched') {
      query.whereNull('matched_run_id').whereNull('error_message');
    }
    if (options?.status === 'error') {
      query.whereNotNull('error_message');
    }

    const limit = options?.limit ?? 100;
    const cursor = options?.cursor ?? 0;
    return query
      .orderBy('created_at', 'desc')
      .orderBy('event_id', 'desc')
      .limit(limit + 1)
      .offset(cursor);
  }
};

export default WorkflowRuntimeEventModelV2;
