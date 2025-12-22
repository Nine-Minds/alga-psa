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
  'email-processing-workflow.v1.json'
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

const loadSystemWorkflowDefinition = (): SystemWorkflowDefinition => {
  const raw = fs.readFileSync(SYSTEM_WORKFLOW_PATH, 'utf8');
  const parsed = JSON.parse(raw) as SystemWorkflowDefinition;
  return { ...parsed, id: SYSTEM_WORKFLOW_ID };
};

export async function ensureSystemEmailWorkflow(db: Knex): Promise<void> {
  const existing = await db('workflow_definitions')
    .where({ workflow_id: SYSTEM_WORKFLOW_ID })
    .first();
  if (existing) {
    return;
  }

  const definition = loadSystemWorkflowDefinition();
  const now = new Date().toISOString();
  const record: Record<string, any> = {
    workflow_id: SYSTEM_WORKFLOW_ID,
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
    record.is_system = true;
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
    .where({ workflow_id: SYSTEM_WORKFLOW_ID, version: definition.version })
    .first();
  if (!versionExists) {
    await db('workflow_definition_versions').insert({
      version_id: uuidv4(),
      workflow_id: SYSTEM_WORKFLOW_ID,
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
