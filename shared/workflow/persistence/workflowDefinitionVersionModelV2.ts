import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';

export type WorkflowDefinitionVersionRecord = {
  version_id: string;
  workflow_id: string;
  // uuid Citus distribution column (backfilled from the parent definition).
  tenant?: string | null;
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

function workflowDefinitionVersions(
  knex: Knex,
  tenant?: string | null,
): Knex.QueryBuilder<WorkflowDefinitionVersionRecord, WorkflowDefinitionVersionRecord[]> {
  return tenant
    ? tenantDb(knex, tenant).table<WorkflowDefinitionVersionRecord>('workflow_definition_versions')
    : knex<WorkflowDefinitionVersionRecord>('workflow_definition_versions');
}

const WorkflowDefinitionVersionModelV2 = {
  create: async (knex: Knex, data: Partial<WorkflowDefinitionVersionRecord>): Promise<WorkflowDefinitionVersionRecord> => {
    const normalized = normalizeWorkflowDefinitionVersionWrite(data);
    const [record] = await workflowDefinitionVersions(knex, data.tenant)
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
    data: Partial<WorkflowDefinitionVersionRecord>,
    tenant?: string | null
  ): Promise<WorkflowDefinitionVersionRecord> => {
    const normalized = normalizeWorkflowDefinitionVersionWrite(data);
    const [record] = await workflowDefinitionVersions(knex, tenant ?? data.tenant)
      .where({ workflow_id: workflowId, version })
      .update({
        ...normalized,
        updated_at: new Date().toISOString()
      })
      .returning('*');
    return record;
  },

  getByWorkflowAndVersion: async (
    knex: Knex,
    workflowId: string,
    version: number,
    tenant?: string | null
  ): Promise<WorkflowDefinitionVersionRecord | null> => {
    const record = await workflowDefinitionVersions(knex, tenant)
      .where({ workflow_id: workflowId, version })
      .first();
    return record || null;
  },

  listByWorkflow: async (
    knex: Knex,
    workflowId: string,
    tenant?: string | null
  ): Promise<WorkflowDefinitionVersionRecord[]> => {
    return workflowDefinitionVersions(knex, tenant)
      .where({ workflow_id: workflowId })
      .orderBy('version', 'desc');
  }
};

export default WorkflowDefinitionVersionModelV2;
