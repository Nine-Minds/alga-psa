exports.up = async function (knex) {
  await knex.schema.createTable('workflow_definitions', (table) => {
    table.uuid('workflow_id').defaultTo(knex.raw('gen_random_uuid()')).primary();
    table.text('name').notNullable();
    table.text('description');
    table.text('payload_schema_ref').notNullable();
    table.jsonb('trigger');
    table.jsonb('draft_definition').notNullable();
    table.integer('draft_version').notNullable().defaultTo(1);
    table.text('status').notNullable().defaultTo('draft');
    table.uuid('created_by');
    table.uuid('updated_by');
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    table.index(['name'], 'idx_workflow_definitions_name');
  });

  await knex.schema.createTable('workflow_definition_versions', (table) => {
    table.uuid('version_id').defaultTo(knex.raw('gen_random_uuid()')).primary();
    table.uuid('workflow_id').notNullable().references('workflow_id').inTable('workflow_definitions').onDelete('CASCADE');
    table.integer('version').notNullable();
    table.jsonb('definition_json').notNullable();
    table.jsonb('payload_schema_json');
    table.uuid('published_by');
    table.timestamp('published_at', { useTz: true });
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    table.unique(['workflow_id', 'version'], { indexName: 'workflow_definition_versions_workflow_version_unique' });
  });

  await knex.schema.createTable('workflow_runs', (table) => {
    table.uuid('run_id').defaultTo(knex.raw('gen_random_uuid()')).primary();
    table.uuid('workflow_id').notNullable().references('workflow_id').inTable('workflow_definitions').onDelete('CASCADE');
    table.integer('workflow_version').notNullable();
    table.text('tenant_id');
    table.text('status').notNullable();
    table.text('node_path');
    table.jsonb('input_json');
    table.jsonb('resume_event_payload');
    table.text('resume_event_name');
    table.jsonb('resume_error');
    table.jsonb('error_json');
    table.text('lease_owner');
    table.timestamp('lease_expires_at', { useTz: true });
    table.timestamp('started_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('completed_at', { useTz: true });
    table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    table.index(['status'], 'idx_workflow_runs_status');
    table.index(['tenant_id', 'status'], 'idx_workflow_runs_tenant_status');
  });

  await knex.schema.createTable('workflow_run_steps', (table) => {
    table.uuid('step_id').defaultTo(knex.raw('gen_random_uuid()')).primary();
    table.uuid('run_id').notNullable().references('run_id').inTable('workflow_runs').onDelete('CASCADE');
    table.text('step_path').notNullable();
    table.text('definition_step_id').notNullable();
    table.text('status').notNullable();
    table.integer('attempt').notNullable().defaultTo(1);
    table.integer('duration_ms');
    table.jsonb('error_json');
    table.uuid('snapshot_id');
    table.timestamp('started_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('completed_at', { useTz: true });

    table.index(['run_id', 'step_path'], 'idx_workflow_run_steps_run_path');
  });

  await knex.schema.createTable('workflow_run_waits', (table) => {
    table.uuid('wait_id').defaultTo(knex.raw('gen_random_uuid()')).primary();
    table.uuid('run_id').notNullable().references('run_id').inTable('workflow_runs').onDelete('CASCADE');
    table.text('step_path').notNullable();
    table.text('wait_type').notNullable();
    table.text('key');
    table.text('event_name');
    table.timestamp('timeout_at', { useTz: true });
    table.text('status').notNullable().defaultTo('WAITING');
    table.jsonb('payload');
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('resolved_at', { useTz: true });

    table.index(['wait_type', 'status'], 'idx_workflow_run_waits_type_status');
    table.index(['event_name', 'key', 'status'], 'idx_workflow_run_waits_event_key');
  });

  await knex.schema.createTable('workflow_action_invocations', (table) => {
    table.uuid('invocation_id').defaultTo(knex.raw('gen_random_uuid()')).primary();
    table.uuid('run_id').notNullable().references('run_id').inTable('workflow_runs').onDelete('CASCADE');
    table.text('step_path').notNullable();
    table.text('action_id').notNullable();
    table.integer('action_version').notNullable();
    table.text('idempotency_key').notNullable();
    table.text('status').notNullable();
    table.integer('attempt').notNullable().defaultTo(1);
    table.text('lease_owner');
    table.timestamp('lease_expires_at', { useTz: true });
    table.jsonb('input_json');
    table.jsonb('output_json');
    table.text('error_message');
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('started_at', { useTz: true });
    table.timestamp('completed_at', { useTz: true });

    table.unique(['action_id', 'action_version', 'idempotency_key'], { indexName: 'workflow_action_invocations_idempotency_unique' });
    table.index(['run_id', 'step_path'], 'idx_workflow_action_invocations_run_path');
  });

  await knex.schema.createTable('workflow_run_snapshots', (table) => {
    table.uuid('snapshot_id').defaultTo(knex.raw('gen_random_uuid()')).primary();
    table.uuid('run_id').notNullable().references('run_id').inTable('workflow_runs').onDelete('CASCADE');
    table.text('step_path').notNullable();
    table.jsonb('envelope_json').notNullable();
    table.integer('size_bytes').notNullable();
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    table.index(['run_id', 'step_path'], 'idx_workflow_run_snapshots_run_path');
  });

  await knex.schema.createTable('workflow_runtime_events', (table) => {
    table.uuid('event_id').defaultTo(knex.raw('gen_random_uuid()')).primary();
    table.text('tenant_id');
    table.text('event_name').notNullable();
    table.text('correlation_key');
    table.jsonb('payload');
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('processed_at', { useTz: true });

    table.index(['event_name', 'correlation_key'], 'idx_workflow_runtime_events_name_key');
  });
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('workflow_runtime_events');
  await knex.schema.dropTableIfExists('workflow_run_snapshots');
  await knex.schema.dropTableIfExists('workflow_action_invocations');
  await knex.schema.dropTableIfExists('workflow_run_waits');
  await knex.schema.dropTableIfExists('workflow_run_steps');
  await knex.schema.dropTableIfExists('workflow_runs');
  await knex.schema.dropTableIfExists('workflow_definition_versions');
  await knex.schema.dropTableIfExists('workflow_definitions');
};
