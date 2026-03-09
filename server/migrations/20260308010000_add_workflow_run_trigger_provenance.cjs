'use strict';

exports.up = async function up(knex) {
  const hasTriggerType = await knex.schema.hasColumn('workflow_runs', 'trigger_type');
  if (!hasTriggerType) {
    await knex.schema.alterTable('workflow_runs', (table) => {
      table.text('trigger_type');
      table.index(['trigger_type'], 'idx_workflow_runs_trigger_type');
    });
  }

  const hasTriggerMetadataJson = await knex.schema.hasColumn('workflow_runs', 'trigger_metadata_json');
  if (!hasTriggerMetadataJson) {
    await knex.schema.alterTable('workflow_runs', (table) => {
      table.jsonb('trigger_metadata_json');
    });
  }
};

exports.down = async function down(knex) {
  const hasTriggerMetadataJson = await knex.schema.hasColumn('workflow_runs', 'trigger_metadata_json');
  if (hasTriggerMetadataJson) {
    await knex.schema.alterTable('workflow_runs', (table) => {
      table.dropColumn('trigger_metadata_json');
    });
  }

  const hasTriggerType = await knex.schema.hasColumn('workflow_runs', 'trigger_type');
  if (hasTriggerType) {
    await knex.schema.alterTable('workflow_runs', (table) => {
      table.dropIndex(['trigger_type'], 'idx_workflow_runs_trigger_type');
      table.dropColumn('trigger_type');
    });
  }
};
