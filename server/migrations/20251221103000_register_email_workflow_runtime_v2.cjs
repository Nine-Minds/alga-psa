const fs = require('fs');
const path = require('path');

const WORKFLOW_ID = '00000000-0000-0000-0000-00000000e001';
const MIGRATION_TENANT = 'migration:20251221103000_register_email_workflow_runtime_v2';
const SYSTEM_WORKFLOW_REGISTRATION_REASON = 'register system email workflow runtime definition';

async function loadTenantDb() {
  return (await import('@alga-psa/db')).tenantDb;
}

function loadDefinition() {
  // Load from utils/ subfolder relative to this migration file
  const filePath = path.join(__dirname, 'utils', 'email-processing-workflow.v2.json');
  if (!fs.existsSync(filePath)) {
    throw new Error(`Missing workflow definition JSON at ${filePath}`);
  }
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

exports.up = async function (knex) {
  const tenantDb = await loadTenantDb();
  const migrationDb = tenantDb(knex, MIGRATION_TENANT);
  // Use v2 workflow with inputMapping format
  const definition = loadDefinition();
  const hasIsSystemColumn = await knex.schema.hasColumn('workflow_definitions', 'is_system');
  const hasIsVisibleColumn = await knex.schema.hasColumn('workflow_definitions', 'is_visible');

  const existing = await migrationDb.unscoped('workflow_definitions', SYSTEM_WORKFLOW_REGISTRATION_REASON).where({ workflow_id: WORKFLOW_ID }).first();
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

    await migrationDb.unscoped('workflow_definitions', SYSTEM_WORKFLOW_REGISTRATION_REASON)
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

  await migrationDb.unscoped('workflow_definitions', SYSTEM_WORKFLOW_REGISTRATION_REASON).insert(insertData);

  await migrationDb.unscoped('workflow_definition_versions', SYSTEM_WORKFLOW_REGISTRATION_REASON).insert({
    workflow_id: WORKFLOW_ID,
    version: definition.version,
    definition_json: definition,
    published_at: new Date().toISOString(),
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  });
};

exports.down = async function (knex) {
  const tenantDb = await loadTenantDb();
  const migrationDb = tenantDb(knex, MIGRATION_TENANT);
  await migrationDb.unscoped('workflow_definition_versions', SYSTEM_WORKFLOW_REGISTRATION_REASON).where({ workflow_id: WORKFLOW_ID }).del();
  await migrationDb.unscoped('workflow_definitions', SYSTEM_WORKFLOW_REGISTRATION_REASON).where({ workflow_id: WORKFLOW_ID }).del();
};
