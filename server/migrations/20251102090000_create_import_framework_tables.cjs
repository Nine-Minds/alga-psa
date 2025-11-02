/**
 * Create foundational tables for the asset import framework.
 * - import_sources: registry of available import adapters per tenant
 * - import_jobs: high-level tracking for each import execution/preview
 * - import_job_items: row-level tracking for validation + execution
 * - external_entity_mappings: linkage between external systems and PSA assets
 */

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function up(knex) {
  // ---------------------------------------------------------------------------
  // Enum types for job + job item statuses
  // ---------------------------------------------------------------------------
  await knex.raw(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'import_job_status') THEN
        CREATE TYPE import_job_status AS ENUM (
          'preview',
          'validating',
          'processing',
          'completed',
          'failed',
          'cancelled'
        );
      END IF;
    END
    $$;
  `);

  await knex.raw(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'import_job_item_status') THEN
        CREATE TYPE import_job_item_status AS ENUM (
          'staged',
          'created',
          'updated',
          'duplicate',
          'error'
        );
      END IF;
    END
    $$;
  `);

  // ---------------------------------------------------------------------------
  // import_sources
  // ---------------------------------------------------------------------------
  await knex.schema.createTable('import_sources', (table) => {
    table.uuid('tenant').notNullable();
    table.uuid('import_source_id').notNullable().defaultTo(knex.raw('gen_random_uuid()'));
    table.text('source_type').notNullable();
    table.text('name').notNullable();
    table.text('description');
    table.jsonb('field_mapping');
    table.specificType('duplicate_detection_fields', 'text[]');
    table.boolean('is_active').notNullable().defaultTo(true);
    table.jsonb('metadata');
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());

    table.primary(['tenant', 'import_source_id']);
    table
      .foreign('tenant')
      .references('tenants.tenant');
    table.unique(['tenant', 'source_type', 'name'], 'uq_import_sources_type_name');
  });

  // ---------------------------------------------------------------------------
  // import_jobs
  // ---------------------------------------------------------------------------
  await knex.schema.createTable('import_jobs', (table) => {
    table.uuid('tenant').notNullable();
    table.uuid('import_job_id').notNullable().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('import_source_id').notNullable();
    table.uuid('job_id');
    table.specificType('status', 'import_job_status').notNullable().defaultTo('preview');
    table.text('file_name');
    table.integer('total_rows').notNullable().defaultTo(0);
    table.integer('processed_rows').notNullable().defaultTo(0);
    table.integer('created_rows').notNullable().defaultTo(0);
    table.integer('updated_rows').notNullable().defaultTo(0);
    table.integer('duplicate_rows').notNullable().defaultTo(0);
    table.integer('error_rows').notNullable().defaultTo(0);
    table.jsonb('preview_data');
    table.jsonb('error_summary');
    table.jsonb('context');
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
    table.timestamp('completed_at');
    table.uuid('created_by').notNullable();

    table.primary(['tenant', 'import_job_id']);
    table
      .foreign('tenant')
      .references('tenants.tenant');
    table
      .foreign(['tenant', 'import_source_id'])
      .references(['tenant', 'import_source_id'])
      .inTable('import_sources');
    table
      .foreign(['tenant', 'job_id'])
      .references(['tenant', 'job_id'])
      .inTable('jobs');
    table
      .foreign(['tenant', 'created_by'])
      .references(['tenant', 'user_id'])
      .inTable('users');
  });

  // ---------------------------------------------------------------------------
  // import_job_items
  // ---------------------------------------------------------------------------
  await knex.schema.createTable('import_job_items', (table) => {
    table.uuid('tenant').notNullable();
    table.uuid('import_job_item_id').notNullable().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('import_job_id').notNullable();
    table.text('external_id');
    table.uuid('asset_id');
    table.jsonb('source_data').notNullable();
    table.jsonb('mapped_data');
    table.jsonb('duplicate_details');
    table.specificType('status', 'import_job_item_status').notNullable().defaultTo('staged');
    table.text('error_message');
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());

    table.primary(['tenant', 'import_job_item_id']);
    table
      .foreign(['tenant', 'import_job_id'])
      .references(['tenant', 'import_job_id'])
      .inTable('import_jobs')
      .onDelete('CASCADE');
    table
      .foreign(['tenant', 'asset_id'])
      .references(['tenant', 'asset_id'])
      .inTable('assets');
  });

  // ---------------------------------------------------------------------------
  // external_entity_mappings
  // ---------------------------------------------------------------------------
  await knex.schema.createTable('external_entity_mappings', (table) => {
    table.uuid('tenant').notNullable();
    table.uuid('external_entity_mapping_id').notNullable().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('asset_id').notNullable();
    table.uuid('import_source_id').notNullable();
    table.text('external_id').notNullable();
    table.text('external_hash');
    table.jsonb('metadata');
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    table.timestamp('last_synced_at').notNullable().defaultTo(knex.fn.now());

    table.primary(['tenant', 'external_entity_mapping_id']);
    table
      .foreign(['tenant', 'asset_id'])
      .references(['tenant', 'asset_id'])
      .inTable('assets');
    table
      .foreign(['tenant', 'import_source_id'])
      .references(['tenant', 'import_source_id'])
      .inTable('import_sources');
    table.unique(['tenant', 'import_source_id', 'external_id'], 'uq_external_entity_unique_source');
  });

  // ---------------------------------------------------------------------------
  // Indexes
  // ---------------------------------------------------------------------------
  await knex.raw('CREATE INDEX IF NOT EXISTS idx_import_sources_active ON import_sources (tenant, is_active)');
  await knex.raw('CREATE INDEX IF NOT EXISTS idx_import_jobs_tenant_status ON import_jobs (tenant, status)');
  await knex.raw('CREATE INDEX IF NOT EXISTS idx_import_jobs_created_at ON import_jobs (tenant, created_at DESC)');
  await knex.raw('CREATE INDEX IF NOT EXISTS idx_import_job_items_job_status ON import_job_items (tenant, import_job_id, status)');
  await knex.raw('CREATE INDEX IF NOT EXISTS idx_external_mappings_asset ON external_entity_mappings (tenant, asset_id)');
  await knex.raw('CREATE INDEX IF NOT EXISTS idx_external_mappings_source ON external_entity_mappings (tenant, import_source_id, external_id)');

  // ---------------------------------------------------------------------------
  // Row Level Security (per-tenant isolation)
  // ---------------------------------------------------------------------------
  const tablesWithRls = [
    'import_sources',
    'import_jobs',
    'import_job_items',
    'external_entity_mappings'
  ];

  for (const table of tablesWithRls) {
    await knex.raw(`
      ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY;

      CREATE POLICY ${table}_tenant_isolation_policy ON ${table}
        USING (tenant = current_setting('app.current_tenant')::uuid);

      CREATE POLICY ${table}_tenant_insert_policy ON ${table}
        FOR INSERT
        WITH CHECK (tenant = current_setting('app.current_tenant')::uuid);
    `);
  }
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('external_entity_mappings');
  await knex.schema.dropTableIfExists('import_job_items');
  await knex.schema.dropTableIfExists('import_jobs');
  await knex.schema.dropTableIfExists('import_sources');

  await knex.raw(`
    DO $$
    BEGIN
      IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'import_job_item_status') THEN
        DROP TYPE import_job_item_status;
      END IF;
    END
    $$;
  `);

  await knex.raw(`
    DO $$
    BEGIN
      IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'import_job_status') THEN
        DROP TYPE import_job_status;
      END IF;
    END
    $$;
  `);
};
