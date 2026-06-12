import { Knex } from 'knex';

export type WorkflowRunRecord = {
  run_id: string;
  workflow_id: string;
  workflow_version: number;
  // uuid Citus distribution column. The legacy `tenant_id` column is being phased
  // out (dropped in the cleanup migration) and is not referenced here.
  tenant?: string | null;
  status: string;
  node_path?: string | null;
  trigger_type?: 'event' | 'schedule' | 'recurring' | null;
  trigger_metadata_json?: Record<string, unknown> | null;
  trigger_fire_key?: string | null;
  event_type?: string | null;
  source_payload_schema_ref?: string | null;
  trigger_mapping_applied?: boolean | null;
  engine?: 'temporal' | 'db' | null;
  temporal_workflow_id?: string | null;
  temporal_run_id?: string | null;
  definition_hash?: string | null;
  runtime_semantics_version?: string | null;
  parent_run_id?: string | null;
  root_run_id?: string | null;
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

  // `tenant` is optional during the transition: when supplied the query prunes to
  // a single Citus shard; when omitted it falls back to a (multi-shard) run_id scan.
  update: async (knex: Knex, runId: string, data: Partial<WorkflowRunRecord>, tenant?: string | null): Promise<WorkflowRunRecord> => {
    const query = knex<WorkflowRunRecord>('workflow_runs').where({ run_id: runId });
    if (tenant) query.andWhere({ tenant });
    const [record] = await query
      .update({
        ...data,
        updated_at: new Date().toISOString()
      })
      .returning('*');
    return record;
  },

  getById: async (knex: Knex, runId: string, tenant?: string | null): Promise<WorkflowRunRecord | null> => {
    const query = knex<WorkflowRunRecord>('workflow_runs').where({ run_id: runId });
    if (tenant) query.andWhere({ tenant });
    const record = await query.first();
    return record || null;
  },

  getByTriggerFireKey: async (knex: Knex, fireKey: string, tenant?: string | null): Promise<WorkflowRunRecord | null> => {
    const query = knex<WorkflowRunRecord>('workflow_runs').where({ trigger_fire_key: fireKey });
    if (tenant) query.andWhere({ tenant });
    const record = await query.first();
    return record || null;
  },

  listByStatus: async (knex: Knex, status: string): Promise<WorkflowRunRecord[]> => {
    return knex<WorkflowRunRecord>('workflow_runs')
      .where({ status })
      .select('*');
  }
};

export default WorkflowRunModelV2;
