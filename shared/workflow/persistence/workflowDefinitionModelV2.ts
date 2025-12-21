import { Knex } from 'knex';

export type WorkflowDefinitionRecord = {
  workflow_id: string;
  name: string;
  description?: string | null;
  payload_schema_ref: string;
  trigger?: Record<string, unknown> | null;
  draft_definition: Record<string, unknown>;
  draft_version: number;
  status: string;
  created_by?: string | null;
  updated_by?: string | null;
  created_at: string;
  updated_at: string;
};

const WorkflowDefinitionModelV2 = {
  create: async (knex: Knex, data: Partial<WorkflowDefinitionRecord>): Promise<WorkflowDefinitionRecord> => {
    const [record] = await knex<WorkflowDefinitionRecord>('workflow_definitions')
      .insert({
        ...data,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .returning('*');
    return record;
  },

  update: async (knex: Knex, workflowId: string, data: Partial<WorkflowDefinitionRecord>): Promise<WorkflowDefinitionRecord> => {
    const [record] = await knex<WorkflowDefinitionRecord>('workflow_definitions')
      .where({ workflow_id: workflowId })
      .update({
        ...data,
        updated_at: new Date().toISOString()
      })
      .returning('*');
    return record;
  },

  getById: async (knex: Knex, workflowId: string): Promise<WorkflowDefinitionRecord | null> => {
    const record = await knex<WorkflowDefinitionRecord>('workflow_definitions')
      .where({ workflow_id: workflowId })
      .first();
    return record || null;
  },

  list: async (knex: Knex): Promise<WorkflowDefinitionRecord[]> => {
    return knex<WorkflowDefinitionRecord>('workflow_definitions').select('*');
  }
};

export default WorkflowDefinitionModelV2;
