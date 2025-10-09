/**
 * Creates extension storage v2 tables backed by Citus.
 */
exports.up = async function up(knex) {
  await knex.schema.createTable('ext_storage_records', (table) => {
    table.uuid('tenant_id').notNullable();
    table.uuid('extension_install_id').notNullable();
    table.string('namespace', 128).notNullable();
    table.string('key', 256).notNullable();
    table.bigInteger('revision').notNullable().defaultTo(1);
    table.jsonb('value').notNullable();
    table.jsonb('metadata').notNullable().defaultTo('{}');
    table.bigInteger('value_size_bytes').notNullable().defaultTo(0);
    table.bigInteger('metadata_size_bytes').notNullable().defaultTo(0);
    table.timestamp('ttl_expires_at').nullable();
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());

    table.primary(['tenant_id', 'extension_install_id', 'namespace', 'key'], {
      constraintName: 'ext_storage_records_pk',
    });
  });

  await knex.schema.createTable('ext_storage_schemas', (table) => {
    table.uuid('tenant_id').notNullable();
    table.uuid('extension_install_id').notNullable();
    table.string('namespace', 128).notNullable();
    table.integer('schema_version').notNullable();
    table.jsonb('schema_document').notNullable();
    table
      .enu('status', ['active', 'deprecated', 'draft'], {
        useNative: false,
        enumName: 'ext_storage_schema_status',
      })
      .notNullable()
      .defaultTo('active');
    table.uuid('created_by').nullable();
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());

    table.primary(['tenant_id', 'extension_install_id', 'namespace', 'schema_version'], {
      constraintName: 'ext_storage_schemas_pk',
    });

    table.unique(
      ['tenant_id', 'extension_install_id', 'namespace'],
      { indexName: 'ext_storage_schemas_namespace_uq' }
    );
  });

  await knex.schema.createTable('ext_storage_usage', (table) => {
    table.uuid('tenant_id').notNullable();
    table.uuid('extension_install_id').notNullable();
    table.bigInteger('bytes_used').notNullable().defaultTo(0);
    table.integer('keys_count').notNullable().defaultTo(0);
    table.integer('namespaces_count').notNullable().defaultTo(0);
    table.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());

    table.primary(['tenant_id', 'extension_install_id'], {
      constraintName: 'ext_storage_usage_pk',
    });
  });

  await knex.schema.raw(`
    SELECT create_distributed_table('ext_storage_records', 'tenant_id', 'hash');
  `);
  await knex.schema.raw(`
    SELECT create_distributed_table('ext_storage_schemas', 'tenant_id', 'hash');
  `);
  await knex.schema.raw(`
    SELECT create_distributed_table('ext_storage_usage', 'tenant_id', 'hash');
  `);

  await knex.schema.raw(`
    CREATE INDEX IF NOT EXISTS ext_storage_records_namespace_idx
      ON ext_storage_records (tenant_id, extension_install_id, namespace, key);
  `);
  await knex.schema.raw(`
    CREATE INDEX IF NOT EXISTS ext_storage_records_ttl_idx
      ON ext_storage_records (tenant_id, extension_install_id, namespace, key)
      WHERE ttl_expires_at IS NOT NULL;
  `);
};

exports.down = async function down(knex) {
  await knex.schema.raw(`
    DROP INDEX IF EXISTS ext_storage_records_namespace_idx;
  `);
  await knex.schema.raw(`
    DROP INDEX IF EXISTS ext_storage_records_ttl_idx;
  `);

  await knex.schema.dropTableIfExists('ext_storage_usage');
  await knex.schema.dropTableIfExists('ext_storage_schemas');
  await knex.schema.dropTableIfExists('ext_storage_records');
};
