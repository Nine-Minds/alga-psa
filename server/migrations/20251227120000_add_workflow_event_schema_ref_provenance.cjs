exports.up = async function (knex) {
  const hasPayloadSchemaRef = await knex.schema.hasColumn('workflow_runtime_events', 'payload_schema_ref');
  if (!hasPayloadSchemaRef) {
    await knex.schema.alterTable('workflow_runtime_events', (table) => {
      table.text('payload_schema_ref');
      table.index(['payload_schema_ref'], 'idx_workflow_runtime_events_payload_schema_ref');
    });
  }

  const hasSchemaRefConflict = await knex.schema.hasColumn('workflow_runtime_events', 'schema_ref_conflict');
  if (!hasSchemaRefConflict) {
    await knex.schema.alterTable('workflow_runtime_events', (table) => {
      table.jsonb('schema_ref_conflict');
    });
  }

  const hasSourcePayloadSchemaRef = await knex.schema.hasColumn('workflow_runs', 'source_payload_schema_ref');
  if (!hasSourcePayloadSchemaRef) {
    await knex.schema.alterTable('workflow_runs', (table) => {
      table.text('source_payload_schema_ref');
      table.index(['source_payload_schema_ref'], 'idx_workflow_runs_source_payload_schema_ref');
    });
  }

  const hasTriggerMappingApplied = await knex.schema.hasColumn('workflow_runs', 'trigger_mapping_applied');
  if (!hasTriggerMappingApplied) {
    await knex.schema.alterTable('workflow_runs', (table) => {
      table.boolean('trigger_mapping_applied').notNullable().defaultTo(false);
      table.index(['trigger_mapping_applied'], 'idx_workflow_runs_trigger_mapping_applied');
    });
  }
};

exports.down = async function (knex) {
  const hasTriggerMappingApplied = await knex.schema.hasColumn('workflow_runs', 'trigger_mapping_applied');
  if (hasTriggerMappingApplied) {
    await knex.schema.alterTable('workflow_runs', (table) => {
      table.dropIndex(['trigger_mapping_applied'], 'idx_workflow_runs_trigger_mapping_applied');
      table.dropColumn('trigger_mapping_applied');
    });
  }

  const hasSourcePayloadSchemaRef = await knex.schema.hasColumn('workflow_runs', 'source_payload_schema_ref');
  if (hasSourcePayloadSchemaRef) {
    await knex.schema.alterTable('workflow_runs', (table) => {
      table.dropIndex(['source_payload_schema_ref'], 'idx_workflow_runs_source_payload_schema_ref');
      table.dropColumn('source_payload_schema_ref');
    });
  }

  const hasSchemaRefConflict = await knex.schema.hasColumn('workflow_runtime_events', 'schema_ref_conflict');
  if (hasSchemaRefConflict) {
    await knex.schema.alterTable('workflow_runtime_events', (table) => {
      table.dropColumn('schema_ref_conflict');
    });
  }

  const hasPayloadSchemaRef = await knex.schema.hasColumn('workflow_runtime_events', 'payload_schema_ref');
  if (hasPayloadSchemaRef) {
    await knex.schema.alterTable('workflow_runtime_events', (table) => {
      table.dropIndex(['payload_schema_ref'], 'idx_workflow_runtime_events_payload_schema_ref');
      table.dropColumn('payload_schema_ref');
    });
  }
};

