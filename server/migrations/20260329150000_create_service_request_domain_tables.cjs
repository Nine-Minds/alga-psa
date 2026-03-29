/**
 * @param {import('knex').Knex} knex
 */
exports.up = async function up(knex) {
  await knex.schema.createTable('service_request_definitions', (table) => {
    table.uuid('tenant').notNullable();
    table.uuid('definition_id').defaultTo(knex.raw('gen_random_uuid()')).notNullable();

    table.text('name').notNullable();
    table.text('description').nullable();
    table.text('icon').nullable();
    table.uuid('category_id').nullable();
    table.integer('sort_order').notNullable().defaultTo(0);
    table.uuid('linked_service_id').nullable();

    table.jsonb('form_schema').notNullable().defaultTo(knex.raw("'{}'::jsonb"));

    table.text('execution_provider').notNullable().defaultTo('ticket-only');
    table.jsonb('execution_config').notNullable().defaultTo(knex.raw("'{}'::jsonb"));
    table.text('form_behavior_provider').notNullable().defaultTo('basic');
    table.jsonb('form_behavior_config').notNullable().defaultTo(knex.raw("'{}'::jsonb"));
    table.text('visibility_provider').notNullable().defaultTo('all-authenticated-client-users');
    table.jsonb('visibility_config').notNullable().defaultTo(knex.raw("'{}'::jsonb"));

    table.text('lifecycle_state').notNullable().defaultTo('draft');
    table.uuid('created_by').nullable();
    table.uuid('updated_by').nullable();
    table.uuid('published_by').nullable();
    table.timestamp('published_at', { useTz: true }).nullable();
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    table.primary(['tenant', 'definition_id']);
    table.foreign('tenant').references('tenants.tenant').onDelete('CASCADE');
    table.foreign(['tenant', 'category_id']).references(['tenant', 'category_id']).inTable('service_categories').onDelete('SET NULL');
    table.foreign(['tenant', 'linked_service_id']).references(['tenant', 'service_id']).inTable('service_catalog').onDelete('SET NULL');
  });

  await knex.schema.raw(`
    ALTER TABLE service_request_definitions
    ADD CONSTRAINT service_request_definitions_lifecycle_state_check
    CHECK (lifecycle_state IN ('draft', 'published', 'archived'))
  `);

  await knex.schema.raw(`
    CREATE INDEX idx_service_request_definitions_tenant_lifecycle
    ON service_request_definitions (tenant, lifecycle_state)
  `);

  await knex.schema.raw(`
    CREATE INDEX idx_service_request_definitions_tenant_sort_order
    ON service_request_definitions (tenant, sort_order)
  `);

  await knex.schema.raw(`
    CREATE INDEX idx_service_request_definitions_tenant_linked_service
    ON service_request_definitions (tenant, linked_service_id)
  `);

  await knex.schema.createTable('service_request_definition_versions', (table) => {
    table.uuid('tenant').notNullable();
    table.uuid('version_id').defaultTo(knex.raw('gen_random_uuid()')).notNullable();
    table.uuid('definition_id').notNullable();
    table.integer('version_number').notNullable();

    table.text('name').notNullable();
    table.text('description').nullable();
    table.text('icon').nullable();
    table.uuid('category_id').nullable();
    table.integer('sort_order').notNullable().defaultTo(0);
    table.uuid('linked_service_id').nullable();

    table.jsonb('form_schema_snapshot').notNullable();

    table.text('execution_provider').notNullable();
    table.jsonb('execution_config').notNullable().defaultTo(knex.raw("'{}'::jsonb"));
    table.text('form_behavior_provider').notNullable();
    table.jsonb('form_behavior_config').notNullable().defaultTo(knex.raw("'{}'::jsonb"));
    table.text('visibility_provider').notNullable();
    table.jsonb('visibility_config').notNullable().defaultTo(knex.raw("'{}'::jsonb"));

    table.uuid('published_by').nullable();
    table.timestamp('published_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    table.primary(['tenant', 'version_id']);
    table.unique(['tenant', 'definition_id', 'version_number'], {
      indexName: 'service_request_definition_versions_definition_version_unique',
    });

    table.foreign(['tenant', 'definition_id'])
      .references(['tenant', 'definition_id'])
      .inTable('service_request_definitions')
      .onDelete('CASCADE');
  });

  await knex.schema.raw(`
    CREATE INDEX idx_service_request_definition_versions_tenant_definition
    ON service_request_definition_versions (tenant, definition_id)
  `);

  await knex.schema.createTable('service_request_submissions', (table) => {
    table.uuid('tenant').notNullable();
    table.uuid('submission_id').defaultTo(knex.raw('gen_random_uuid()')).notNullable();
    table.uuid('definition_id').notNullable();
    table.uuid('definition_version_id').notNullable();

    table.uuid('requester_user_id').nullable();
    table.uuid('client_id').notNullable();
    table.uuid('contact_id').nullable();

    table.text('request_name').notNullable();
    table.jsonb('submitted_payload').notNullable();

    table.text('execution_status').notNullable().defaultTo('pending');
    table.text('execution_error_summary').nullable();
    table.uuid('created_ticket_id').nullable();
    table.text('workflow_execution_id').nullable();

    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    table.primary(['tenant', 'submission_id']);

    table.foreign(['tenant', 'definition_id'])
      .references(['tenant', 'definition_id'])
      .inTable('service_request_definitions')
      .onDelete('RESTRICT');

    table.foreign(['tenant', 'definition_version_id'])
      .references(['tenant', 'version_id'])
      .inTable('service_request_definition_versions')
      .onDelete('RESTRICT');
  });

  await knex.schema.raw(`
    ALTER TABLE service_request_submissions
    ADD CONSTRAINT service_request_submissions_execution_status_check
    CHECK (execution_status IN ('pending', 'succeeded', 'failed'))
  `);

  await knex.schema.raw(`
    CREATE INDEX idx_service_request_submissions_tenant_client_created_at
    ON service_request_submissions (tenant, client_id, created_at DESC)
  `);

  await knex.schema.raw(`
    CREATE INDEX idx_service_request_submissions_tenant_definition_created_at
    ON service_request_submissions (tenant, definition_id, created_at DESC)
  `);

  await knex.schema.raw(`
    CREATE INDEX idx_service_request_submissions_tenant_requester_created_at
    ON service_request_submissions (tenant, requester_user_id, created_at DESC)
  `);

  await knex.schema.createTable('service_request_submission_attachments', (table) => {
    table.uuid('tenant').notNullable();
    table.uuid('submission_attachment_id').defaultTo(knex.raw('gen_random_uuid()')).notNullable();
    table.uuid('submission_id').notNullable();

    table.uuid('file_id').notNullable();
    table.text('file_name').nullable();
    table.text('mime_type').nullable();
    table.bigInteger('file_size').nullable();

    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    table.primary(['tenant', 'submission_attachment_id']);
    table.unique(['tenant', 'submission_id', 'file_id'], {
      indexName: 'service_request_submission_attachments_submission_file_unique',
    });

    table.foreign(['tenant', 'submission_id'])
      .references(['tenant', 'submission_id'])
      .inTable('service_request_submissions')
      .onDelete('CASCADE');
  });

  await knex.schema.raw(`
    CREATE INDEX idx_service_request_submission_attachments_tenant_submission
    ON service_request_submission_attachments (tenant, submission_id)
  `);

  const citusFn = await knex.raw(`
    SELECT EXISTS (
      SELECT 1 FROM pg_proc
      WHERE proname = 'create_distributed_table'
    ) AS exists;
  `);

  if (citusFn.rows?.[0]?.exists) {
    await knex.raw("SELECT create_distributed_table('service_request_definitions', 'tenant')");
    await knex.raw("SELECT create_distributed_table('service_request_definition_versions', 'tenant')");
    await knex.raw("SELECT create_distributed_table('service_request_submissions', 'tenant')");
    await knex.raw("SELECT create_distributed_table('service_request_submission_attachments', 'tenant')");
  } else {
    console.warn('[create_service_request_domain_tables] Skipping create_distributed_table (function unavailable)');
  }
};

/**
 * @param {import('knex').Knex} knex
 */
exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('service_request_submission_attachments');
  await knex.schema.dropTableIfExists('service_request_submissions');
  await knex.schema.dropTableIfExists('service_request_definition_versions');
  await knex.schema.dropTableIfExists('service_request_definitions');
};

exports.config = { transaction: false };
