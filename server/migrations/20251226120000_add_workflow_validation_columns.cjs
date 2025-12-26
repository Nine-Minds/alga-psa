exports.up = async function (knex) {
  const hasDefinitionStatus = await knex.schema.hasColumn('workflow_definitions', 'validation_status');
  if (!hasDefinitionStatus) {
    await knex.schema.alterTable('workflow_definitions', (table) => {
      table.text('validation_status');
      table.jsonb('validation_errors');
      table.jsonb('validation_warnings');
      table.timestamp('validated_at', { useTz: true });
    });
  }

  const hasVersionStatus = await knex.schema.hasColumn('workflow_definition_versions', 'validation_status');
  if (!hasVersionStatus) {
    await knex.schema.alterTable('workflow_definition_versions', (table) => {
      table.text('validation_status');
      table.jsonb('validation_errors');
      table.jsonb('validation_warnings');
      table.timestamp('validated_at', { useTz: true });
    });
  }
};

exports.down = async function (knex) {
  const hasDefinitionStatus = await knex.schema.hasColumn('workflow_definitions', 'validation_status');
  if (hasDefinitionStatus) {
    await knex.schema.alterTable('workflow_definitions', (table) => {
      table.dropColumn('validation_status');
      table.dropColumn('validation_errors');
      table.dropColumn('validation_warnings');
      table.dropColumn('validated_at');
    });
  }

  const hasVersionStatus = await knex.schema.hasColumn('workflow_definition_versions', 'validation_status');
  if (hasVersionStatus) {
    await knex.schema.alterTable('workflow_definition_versions', (table) => {
      table.dropColumn('validation_status');
      table.dropColumn('validation_errors');
      table.dropColumn('validation_warnings');
      table.dropColumn('validated_at');
    });
  }
};
