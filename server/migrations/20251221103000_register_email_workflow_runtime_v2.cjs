const fs = require('fs');
const path = require('path');

const WORKFLOW_ID = '00000000-0000-0000-0000-00000000e001';

function resolveExistingPath(paths) {
  for (const entry of paths) {
    try {
      if (entry && fs.existsSync(entry)) return entry;
    } catch {
      // ignore
    }
  }
  return null;
}

function loadDefinition() {
  const rel = path.join('shared', 'workflow', 'runtime', 'workflows', 'email-processing-workflow.v2.json');

  // NOTE: EE migrations are executed from a temporary directory (see scripts/run-ee-migrations.js),
  // so __dirname is not stable. Prefer resolving from process.cwd() and well-known container roots.
  const candidates = [
    path.resolve(process.cwd(), rel),
    path.resolve(process.cwd(), '..', rel),
    path.resolve(process.cwd(), '..', '..', rel),
    path.resolve('/app', rel),
    path.resolve(__dirname, '..', '..', rel), // legacy fallback
  ];

  const filePath = resolveExistingPath(candidates);
  if (!filePath) {
    throw new Error(
      `Missing workflow definition JSON (${rel}). Looked in: ${candidates.join(', ')} (cwd=${process.cwd()}, __dirname=${__dirname})`
    );
  }

  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

exports.up = async function (knex) {
  // Use v2 workflow with inputMapping format
  const definition = loadDefinition();
  const hasIsSystemColumn = await knex.schema.hasColumn('workflow_definitions', 'is_system');
  const hasIsVisibleColumn = await knex.schema.hasColumn('workflow_definitions', 'is_visible');

  const existing = await knex('workflow_definitions').where({ workflow_id: WORKFLOW_ID }).first();
  if (existing) {
    const updateData = {
      draft_definition: definition,
      draft_version: definition.version,
      name: definition.name,
      description: definition.description,
      payload_schema_ref: definition.payloadSchemaRef,
      trigger: definition.trigger,
      updated_at: new Date().toISOString()
    };
    if (hasIsSystemColumn) {
      updateData.is_system = true;
    }
    if (hasIsVisibleColumn) {
      updateData.is_visible = true;
    }

    await knex('workflow_definitions')
      .where({ workflow_id: WORKFLOW_ID })
      .update(updateData);
    return;
  }

  const insertData = {
    workflow_id: WORKFLOW_ID,
    name: definition.name,
    description: definition.description,
    payload_schema_ref: definition.payloadSchemaRef,
    trigger: definition.trigger,
    draft_definition: definition,
    draft_version: definition.version,
    status: 'draft',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };
  if (hasIsSystemColumn) {
    insertData.is_system = true;
  }
  if (hasIsVisibleColumn) {
    insertData.is_visible = true;
  }

  await knex('workflow_definitions').insert(insertData);

  await knex('workflow_definition_versions').insert({
    workflow_id: WORKFLOW_ID,
    version: definition.version,
    definition_json: definition,
    published_at: new Date().toISOString(),
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  });
};

exports.down = async function (knex) {
  await knex('workflow_definition_versions').where({ workflow_id: WORKFLOW_ID }).del();
  await knex('workflow_definitions').where({ workflow_id: WORKFLOW_ID }).del();
};
