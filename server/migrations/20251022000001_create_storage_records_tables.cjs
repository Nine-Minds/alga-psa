/**
 * Create storage_records, storage_schemas, and storage_usage tables
 * These are for the generic storage API (not extension-specific)
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function(knex) {
  // Create storage_records table
  if (!(await knex.schema.hasTable('storage_records'))) {
    await knex.schema.createTable('storage_records', (table) => {
      table.uuid('tenant').notNullable();
      table.string('namespace', 128).notNullable();
      table.string('key', 256).notNullable();
      table.bigInteger('revision').notNullable().defaultTo(1);
      table.jsonb('value').notNullable();
      table.jsonb('metadata').notNullable().defaultTo(knex.raw(`'{}'::jsonb`));
      table.bigInteger('value_size_bytes').notNullable().defaultTo(0);
      table.bigInteger('metadata_size_bytes').notNullable().defaultTo(0);
      table.timestamp('ttl_expires_at').nullable();
      table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
      table.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
      table.primary(['tenant', 'namespace', 'key'], { constraintName: 'storage_records_pk' });
    });

    // Create indexes
    await knex.schema.raw(`
      CREATE INDEX IF NOT EXISTS storage_records_namespace_idx
        ON storage_records (tenant, namespace, key)
    `);

    await knex.schema.raw(`
      CREATE INDEX IF NOT EXISTS storage_records_ttl_idx
        ON storage_records (tenant, namespace, key)
        WHERE ttl_expires_at IS NOT NULL
    `);

    console.log('Created storage_records table with indexes');
  }

  // Create storage_schemas table
  if (!(await knex.schema.hasTable('storage_schemas'))) {
    await knex.schema.createTable('storage_schemas', (table) => {
      table.uuid('tenant').notNullable();
      table.string('namespace', 128).notNullable();
      table.integer('schema_version').notNullable();
      table.jsonb('schema_document').notNullable();
      table.enu('status', ['active', 'deprecated', 'draft']).notNullable().defaultTo('active');
      table.uuid('created_by').nullable();
      table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
      table.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
      table.primary(['tenant', 'namespace', 'schema_version'], { constraintName: 'storage_schemas_pk' });
    });

    // Create unique index for active schemas
    await knex.schema.raw(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_class c
          JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE c.relkind = 'i' AND c.relname = 'storage_schemas_namespace_active_uq'
        ) THEN
          CREATE UNIQUE INDEX storage_schemas_namespace_active_uq
            ON storage_schemas (tenant, namespace)
            WHERE status = 'active';
        END IF;
      END$$;
    `);

    console.log('Created storage_schemas table with unique index');
  }

  // Create storage_usage table
  if (!(await knex.schema.hasTable('storage_usage'))) {
    await knex.schema.createTable('storage_usage', (table) => {
      table.uuid('tenant').notNullable();
      table.bigInteger('bytes_used').notNullable().defaultTo(0);
      table.integer('keys_count').notNullable().defaultTo(0);
      table.integer('namespaces_count').notNullable().defaultTo(0);
      table.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
      table.primary(['tenant'], { constraintName: 'storage_usage_pk' });
    });

    console.log('Created storage_usage table');
  }
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function(knex) {
  // Drop tables in reverse order to avoid foreign key issues
  await knex.schema.dropTableIfExists('storage_usage');
  await knex.schema.dropTableIfExists('storage_schemas');
  await knex.schema.dropTableIfExists('storage_records');
  console.log('Dropped storage tables');
};
