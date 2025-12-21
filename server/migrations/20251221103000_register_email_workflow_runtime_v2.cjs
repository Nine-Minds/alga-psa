const fs = require('fs');
const path = require('path');

const WORKFLOW_ID = '00000000-0000-0000-0000-00000000e001';

exports.up = async function (knex) {
  const filePath = path.resolve(__dirname, '..', '..', 'shared', 'workflow', 'runtime', 'workflows', 'email-processing-workflow.v1.json');
  const definition = JSON.parse(fs.readFileSync(filePath, 'utf8'));

  const existing = await knex('workflow_definitions').where({ workflow_id: WORKFLOW_ID }).first();
  if (existing) {
    await knex('workflow_definitions')
      .where({ workflow_id: WORKFLOW_ID })
      .update({
        draft_definition: definition,
        draft_version: definition.version,
        name: definition.name,
        description: definition.description,
        payload_schema_ref: definition.payloadSchemaRef,
        trigger: definition.trigger,
        updated_at: new Date().toISOString()
      });
    return;
  }

  await knex('workflow_definitions').insert({
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
  });

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
