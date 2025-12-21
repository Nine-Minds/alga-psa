import { Knex } from 'knex';

export type WorkflowActionInvocationRecord = {
  invocation_id: string;
  run_id: string;
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

const WorkflowActionInvocationModelV2 = {
  create: async (knex: Knex, data: Partial<WorkflowActionInvocationRecord>): Promise<WorkflowActionInvocationRecord> => {
    const [record] = await knex<WorkflowActionInvocationRecord>('workflow_action_invocations')
      .insert({
        ...data,
        created_at: data.created_at ?? new Date().toISOString()
      })
      .returning('*');
    return record;
  },

  update: async (knex: Knex, invocationId: string, data: Partial<WorkflowActionInvocationRecord>): Promise<WorkflowActionInvocationRecord> => {
    const [record] = await knex<WorkflowActionInvocationRecord>('workflow_action_invocations')
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
    idempotencyKey: string
  ): Promise<WorkflowActionInvocationRecord | null> => {
    const record = await knex<WorkflowActionInvocationRecord>('workflow_action_invocations')
      .where({
        action_id: actionId,
        action_version: actionVersion,
        idempotency_key: idempotencyKey
      })
      .first();
    return record || null;
  },

  listByRun: async (knex: Knex, runId: string): Promise<WorkflowActionInvocationRecord[]> => {
    return knex<WorkflowActionInvocationRecord>('workflow_action_invocations')
      .where({ run_id: runId })
      .orderBy('created_at', 'asc');
  }
};

export default WorkflowActionInvocationModelV2;
