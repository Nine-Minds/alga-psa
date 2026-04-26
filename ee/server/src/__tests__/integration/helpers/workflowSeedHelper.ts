import { createHash } from 'crypto';
import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import type { Knex } from 'knex';

const SYSTEM_WORKFLOW_ID = '00000000-0000-0000-0000-00000000e001';
const SYSTEM_WORKFLOW_PATH = path.resolve(
  process.cwd(),
  '..',
  '..',
  'shared',
  'workflow',
  'runtime',
  'workflows',
  'email-processing-workflow.v2.json'
);

type SystemWorkflowDefinition = {
  id: string;
  version: number;
  name: string;
  description?: string;
  payloadSchemaRef: string;
  trigger?: Record<string, unknown> | null;
  steps: Array<Record<string, unknown>>;
};

const tenantWorkflowId = (tenantId: string): string => {
  const hex = createHash('sha256').update(`${SYSTEM_WORKFLOW_ID}:${tenantId}`).digest('hex').slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};

const loadSystemWorkflowDefinition = (workflowId: string): SystemWorkflowDefinition => {
  const raw = fs.readFileSync(SYSTEM_WORKFLOW_PATH, 'utf8');
  const parsed = JSON.parse(raw) as SystemWorkflowDefinition;
  return { ...parsed, id: workflowId };
};

export async function ensureSystemEmailWorkflow(db: Knex, tenantId?: string): Promise<void> {
  const resolvedTenantId = tenantId ?? (await db('tenants').select('tenant').first())?.tenant;
  if (!resolvedTenantId) {
    throw new Error('tenant_id is required to seed the legacy email workflow fixture');
  }

  const workflowId = tenantWorkflowId(resolvedTenantId);
  const existing = await db('workflow_definitions')
    .where({ workflow_id: workflowId, tenant_id: resolvedTenantId })
    .first();
  if (existing) {
    return;
  }

  const definition = loadSystemWorkflowDefinition(workflowId);
  const now = new Date().toISOString();
  const record: Record<string, any> = {
    workflow_id: workflowId,
    tenant_id: resolvedTenantId,
    name: definition.name,
    description: definition.description ?? null,
    payload_schema_ref: definition.payloadSchemaRef,
    trigger: definition.trigger ?? null,
    draft_definition: definition,
    draft_version: definition.version,
    status: 'draft',
    created_at: now,
    updated_at: now
  };

  if (await db.schema.hasColumn('workflow_definitions', 'is_system')) {
    record.is_system = false;
  }
  if (await db.schema.hasColumn('workflow_definitions', 'is_visible')) {
    record.is_visible = true;
  }

  await db('workflow_definitions').insert(record).onConflict('workflow_id').ignore();

  const hasVersionsTable = await db.schema.hasTable('workflow_definition_versions');
  if (!hasVersionsTable) {
    return;
  }

  const versionExists = await db('workflow_definition_versions')
    .where({ workflow_id: workflowId, version: definition.version })
    .first();
  if (!versionExists) {
    await db('workflow_definition_versions').insert({
      version_id: uuidv4(),
      workflow_id: workflowId,
      version: definition.version,
      definition_json: definition,
      payload_schema_json: null,
      published_by: null,
      published_at: now,
      created_at: now,
      updated_at: now
    });
  }
}
