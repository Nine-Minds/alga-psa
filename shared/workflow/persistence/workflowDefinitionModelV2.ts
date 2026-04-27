import { Knex } from 'knex';

export type WorkflowDefinitionRecord = {
  workflow_id: string;
  tenant_id: string;
  key?: string | null;
  name: string;
  description?: string | null;
  payload_schema_ref: string;
  payload_schema_mode?: 'inferred' | 'pinned' | string | null;
  pinned_payload_schema_ref?: string | null;
  payload_schema_provenance?: string | null;
  trigger?: Record<string, unknown> | null;
  draft_definition: Record<string, unknown>;
  draft_version: number;
  status: string;
  validation_status?: string | null;
  validation_errors?: Record<string, unknown>[] | null;
  validation_warnings?: Record<string, unknown>[] | null;
  validation_context_json?: Record<string, unknown> | null;
  validation_payload_schema_hash?: string | null;
  validated_at?: string | null;
  published_version?: number | null;
  is_system?: boolean;
  is_visible?: boolean;
  is_paused?: boolean;
  concurrency_limit?: number | null;
  auto_pause_on_failure?: boolean;
  failure_rate_threshold?: number | string | null;
  failure_rate_min_runs?: number | null;
  retention_policy_override?: Record<string, unknown> | null;
  created_by?: string | null;
  updated_by?: string | null;
  created_at: string;
  updated_at: string;
};

const serializeJsonArrayForPgJsonColumn = (value: unknown): unknown => {
  // node-postgres treats JS arrays as Postgres arrays, not JSON, which breaks inserts into `json/jsonb` columns.
  // Serialize explicitly so Postgres receives valid JSON text (e.g. `[{"...": "..."}]`).
  return Array.isArray(value) ? JSON.stringify(value) : value;
};

const normalizeWorkflowDefinitionWrite = (
  data: Partial<WorkflowDefinitionRecord>
): Partial<WorkflowDefinitionRecord> => {
  const out: Partial<WorkflowDefinitionRecord> = { ...data };

  if ('validation_errors' in out) {
    out.validation_errors = serializeJsonArrayForPgJsonColumn(out.validation_errors) as any;
  }
  if ('validation_warnings' in out) {
    out.validation_warnings = serializeJsonArrayForPgJsonColumn(out.validation_warnings) as any;
  }

  return out;
};

const assertTenantId = (tenantId: string | null | undefined): string => {
  const normalized = String(tenantId ?? '').trim();
  if (!normalized) {
    throw new Error('tenant_id is required for workflow definition access');
  }
  return normalized;
};

const WorkflowDefinitionModelV2 = {
  create: async (knex: Knex, tenantId: string, data: Partial<WorkflowDefinitionRecord>): Promise<WorkflowDefinitionRecord> => {
    const tenant = assertTenantId(tenantId);
    const normalized = normalizeWorkflowDefinitionWrite(data);
    const [record] = await knex<WorkflowDefinitionRecord>('workflow_definitions')
      .insert({
        ...normalized,
        tenant_id: tenant,
        is_system: false,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .returning('*');
    return record;
  },

  update: async (knex: Knex, tenantId: string, workflowId: string, data: Partial<WorkflowDefinitionRecord>): Promise<WorkflowDefinitionRecord> => {
    const tenant = assertTenantId(tenantId);
    const normalized = normalizeWorkflowDefinitionWrite(data);
    delete (normalized as Partial<WorkflowDefinitionRecord>).tenant_id;
    const [record] = await knex<WorkflowDefinitionRecord>('workflow_definitions')
      .where({ workflow_id: workflowId, tenant_id: tenant })
      .update({
        ...normalized,
        is_system: false,
        updated_at: new Date().toISOString()
      })
      .returning('*');
    return record;
  },

  getById: async (knex: Knex, tenantId: string, workflowId: string): Promise<WorkflowDefinitionRecord | null> => {
    const tenant = assertTenantId(tenantId);
    const record = await knex<WorkflowDefinitionRecord>('workflow_definitions')
      .where({ workflow_id: workflowId, tenant_id: tenant })
      .first();
    return record || null;
  },

  list: async (knex: Knex, tenantId: string): Promise<WorkflowDefinitionRecord[]> => {
    const tenant = assertTenantId(tenantId);
    return knex<WorkflowDefinitionRecord>('workflow_definitions')
      .select('*')
      .where({ tenant_id: tenant });
  }
};

export default WorkflowDefinitionModelV2;
