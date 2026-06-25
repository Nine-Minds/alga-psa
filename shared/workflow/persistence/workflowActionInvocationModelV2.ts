import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';

export type WorkflowActionInvocationRecord = {
  invocation_id: string;
  run_id: string;
  // uuid Citus distribution column (backfilled from the parent run).
  tenant?: string | null;
  step_path: string;
  action_id: string;
  action_version: number;
  idempotency_key: string;
  status: string;
  attempt: number;
  lease_owner?: string | null;
  lease_expires_at?: string | null;
  input_json?: Record<string, unknown> | null;
  output_json?: Record<string, unknown> | null;
  error_message?: string | null;
  created_at: string;
  started_at?: string | null;
  completed_at?: string | null;
};

function workflowActionInvocations(
  knex: Knex,
  tenant?: string | null,
): Knex.QueryBuilder<WorkflowActionInvocationRecord, WorkflowActionInvocationRecord[]> {
  return tenant
    ? tenantDb(knex, tenant).table<WorkflowActionInvocationRecord>('workflow_action_invocations')
    : knex<WorkflowActionInvocationRecord>('workflow_action_invocations');
}

const WorkflowActionInvocationModelV2 = {
  create: async (knex: Knex, data: Partial<WorkflowActionInvocationRecord>): Promise<WorkflowActionInvocationRecord> => {
    const [record] = await workflowActionInvocations(knex, data.tenant)
      .insert({
        ...data,
        created_at: data.created_at ?? new Date().toISOString()
      })
      .returning('*');
    return record;
  },

  update: async (knex: Knex, invocationId: string, data: Partial<WorkflowActionInvocationRecord>, tenant?: string | null): Promise<WorkflowActionInvocationRecord> => {
    const [record] = await workflowActionInvocations(knex, tenant)
      .where({ invocation_id: invocationId })
      .update({
        ...data
      })
      .returning('*');
    return record;
  },

  findByIdempotency: async (
    knex: Knex,
    actionId: string,
    actionVersion: number,
    idempotencyKey: string,
    tenant?: string | null
  ): Promise<WorkflowActionInvocationRecord | null> => {
    const record = await workflowActionInvocations(knex, tenant)
      .where({
        action_id: actionId,
        action_version: actionVersion,
        idempotency_key: idempotencyKey
      })
      .first();
    return record || null;
  },

  listByRun: async (knex: Knex, runId: string, tenant?: string | null): Promise<WorkflowActionInvocationRecord[]> => {
    return workflowActionInvocations(knex, tenant)
      .where({ run_id: runId })
      .orderBy('created_at', 'asc');
  }
};

export default WorkflowActionInvocationModelV2;
