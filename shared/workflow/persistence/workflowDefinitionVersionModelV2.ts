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

const serializeJsonArrayForPgJsonColumn = (value: unknown): unknown => {
  // node-postgres treats JS arrays as Postgres arrays, not JSON, which breaks inserts into `json/jsonb` columns.
  // Serialize explicitly so Postgres receives valid JSON text (e.g. `[{"...": "..."}]`).
  return Array.isArray(value) ? JSON.stringify(value) : value;
};

const normalizeWorkflowDefinitionVersionWrite = (
  data: Partial<WorkflowDefinitionVersionRecord>
): Partial<WorkflowDefinitionVersionRecord> => {
  const out: Partial<WorkflowDefinitionVersionRecord> = { ...data };

  if ('validation_errors' in out) {
    out.validation_errors = serializeJsonArrayForPgJsonColumn(out.validation_errors) as any;
  }
  if ('validation_warnings' in out) {
    out.validation_warnings = serializeJsonArrayForPgJsonColumn(out.validation_warnings) as any;
  }

  return out;
};

const WorkflowDefinitionVersionModelV2 = {
  create: async (knex: Knex, data: Partial<WorkflowDefinitionVersionRecord>): Promise<WorkflowDefinitionVersionRecord> => {
    const normalized = normalizeWorkflowDefinitionVersionWrite(data);
    const [record] = await knex<WorkflowDefinitionVersionRecord>('workflow_definition_versions')
      .insert({
        ...normalized,
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
    const normalized = normalizeWorkflowDefinitionVersionWrite(data);
    const [record] = await knex<WorkflowDefinitionVersionRecord>('workflow_definition_versions')
      .where({ workflow_id: workflowId, version })
      .update({
        ...normalized,
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
