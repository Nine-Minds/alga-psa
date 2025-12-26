import { Knex } from 'knex';

export type WorkflowDefinitionVersionRecord = {
  version_id: string;
  workflow_id: string;
  version: number;
  definition_json: Record<string, unknown>;
  payload_schema_json?: Record<string, unknown> | null;
  validation_status?: string | null;
  validation_errors?: Record<string, unknown>[] | null;
  validation_warnings?: Record<string, unknown>[] | null;
  validated_at?: string | null;
  published_by?: string | null;
  published_at?: string | null;
  created_at: string;
  updated_at: string;
};

const WorkflowDefinitionVersionModelV2 = {
  create: async (knex: Knex, data: Partial<WorkflowDefinitionVersionRecord>): Promise<WorkflowDefinitionVersionRecord> => {
    const [record] = await knex<WorkflowDefinitionVersionRecord>('workflow_definition_versions')
      .insert({
        ...data,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .returning('*');
    return record;
  },

  update: async (
    knex: Knex,
    workflowId: string,
    version: number,
    data: Partial<WorkflowDefinitionVersionRecord>
  ): Promise<WorkflowDefinitionVersionRecord> => {
    const [record] = await knex<WorkflowDefinitionVersionRecord>('workflow_definition_versions')
      .where({ workflow_id: workflowId, version })
      .update({
        ...data,
        updated_at: new Date().toISOString()
      })
      .returning('*');
    return record;
  },

  getByWorkflowAndVersion: async (knex: Knex, workflowId: string, version: number): Promise<WorkflowDefinitionVersionRecord | null> => {
    const record = await knex<WorkflowDefinitionVersionRecord>('workflow_definition_versions')
      .where({ workflow_id: workflowId, version })
      .first();
    return record || null;
  },

  listByWorkflow: async (knex: Knex, workflowId: string): Promise<WorkflowDefinitionVersionRecord[]> => {
    return knex<WorkflowDefinitionVersionRecord>('workflow_definition_versions')
      .where({ workflow_id: workflowId })
      .orderBy('version', 'desc');
  }
};

export default WorkflowDefinitionVersionModelV2;
