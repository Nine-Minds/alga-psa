import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';

export type WorkflowDefinitionRecord = {
  workflow_id: string;
  // uuid Citus distribution column. The legacy textual `tenant_id` column is
  // being phased out (dropped in the cleanup migration) and is not referenced here.
  tenant: string;
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

function workflowDefinitions(
  knex: Knex,
  tenant: string,
): Knex.QueryBuilder<WorkflowDefinitionRecord, WorkflowDefinitionRecord[]> {
  return tenantDb(knex, tenant).table<WorkflowDefinitionRecord>('workflow_definitions');
}

const WorkflowDefinitionModelV2 = {
  create: async (knex: Knex, tenantId: string, data: Partial<WorkflowDefinitionRecord>): Promise<WorkflowDefinitionRecord> => {
    const tenant = assertTenantId(tenantId);
    const normalized = normalizeWorkflowDefinitionWrite(data);
    const [record] = await workflowDefinitions(knex, tenant)
      .insert({
        ...normalized,
        tenant,
        is_system: false,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .returning('*');
    return record;
  },

  update: async (
    knex: Knex,
    tenantId: string,
    workflowId: string,
    data: Partial<WorkflowDefinitionRecord>,
    options?: {
      /**
       * Optimistic concurrency: only apply the update when the stored
       * draft_version still matches. When it doesn't, no row is written and
       * null is returned — the caller decides between 404 and 409.
       */
      expectedDraftVersion?: number;
    }
  ): Promise<WorkflowDefinitionRecord | null> => {
    const tenant = assertTenantId(tenantId);
    const normalized = normalizeWorkflowDefinitionWrite(data);
    delete (normalized as Record<string, unknown>).tenant_id;
    delete (normalized as Record<string, unknown>).tenant;
    let query = workflowDefinitions(knex, tenant).where({ workflow_id: workflowId });
    if (options?.expectedDraftVersion !== undefined) {
      query = query.where({ draft_version: options.expectedDraftVersion });
    }
    const [record] = await query
      .update({
        ...normalized,
        is_system: false,
        updated_at: new Date().toISOString()
      })
      .returning('*');
    return record ?? null;
  },

  getById: async (knex: Knex, tenantId: string, workflowId: string): Promise<WorkflowDefinitionRecord | null> => {
    const tenant = assertTenantId(tenantId);
    const record = await workflowDefinitions(knex, tenant)
      .where({ workflow_id: workflowId })
      .first();
    return record || null;
  },

  list: async (knex: Knex, tenantId: string): Promise<WorkflowDefinitionRecord[]> => {
    const tenant = assertTenantId(tenantId);
    return workflowDefinitions(knex, tenant).select('*');
  }
};

export default WorkflowDefinitionModelV2;
