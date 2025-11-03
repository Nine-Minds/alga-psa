/**
 * Creates extension storage v2 tables backed by Citus.
 */
exports.up = async function up(knex) {
  const ensureTable = async (tableName, creator) => {
    const exists = await knex.schema.hasTable(tableName);
    if (!exists) {
      await creator();
    }
  };

  await ensureTable('ext_storage_records', async () => {
    await knex.schema.createTable('ext_storage_records', (table) => {
      table.uuid('tenant').notNullable();
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

      table.primary(['tenant', 'extension_install_id', 'namespace', 'key'], {
        constraintName: 'ext_storage_records_pk',
      });
    });
  });

  await ensureTable('ext_storage_schemas', async () => {
    await knex.schema.createTable('ext_storage_schemas', (table) => {
      table.uuid('tenant').notNullable();
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

      table.primary(['tenant', 'extension_install_id', 'namespace', 'schema_version'], {
        constraintName: 'ext_storage_schemas_pk',
      });
    });
  });

  await ensureTable('ext_storage_usage', async () => {
    await knex.schema.createTable('ext_storage_usage', (table) => {
      table.uuid('tenant').notNullable();
      table.uuid('extension_install_id').notNullable();
      table.bigInteger('bytes_used').notNullable().defaultTo(0);
      table.integer('keys_count').notNullable().defaultTo(0);
      table.integer('namespaces_count').notNullable().defaultTo(0);
      table.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());

      table.primary(['tenant', 'extension_install_id'], {
        constraintName: 'ext_storage_usage_pk',
      });
    });
  });

  // Partial unique index: enforce single active schema per namespace
  await knex.schema.raw(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE c.relkind = 'i' AND c.relname = 'ext_storage_schemas_namespace_active_uq'
      ) THEN
        CREATE UNIQUE INDEX ext_storage_schemas_namespace_active_uq
          ON ext_storage_schemas (tenant, extension_install_id, namespace)
          WHERE status = 'active';
      END IF;
    END$$;
  `);

  // Distribute tables only if Citus is installed and table not yet distributed
  const citusEnabled = await knex.raw(`
    SELECT EXISTS (
      SELECT 1 FROM pg_extension WHERE extname = 'citus'
    ) as enabled
  `);

  if (citusEnabled.rows?.[0]?.enabled) {
    const ensureDistributed = async (tableName) => {
      const alreadyDistributed = await knex.raw(
        `SELECT EXISTS (SELECT 1 FROM pg_dist_partition WHERE logicalrelid = '${tableName}'::regclass) AS exists`
      );
      if (!alreadyDistributed.rows?.[0]?.exists) {
        await knex.schema.raw(`
          SELECT create_distributed_table('${tableName}', 'tenant', 'hash');
        `);
      }
    };

    await ensureDistributed('ext_storage_records');
    await ensureDistributed('ext_storage_schemas');
    await ensureDistributed('ext_storage_usage');
  } else {
    console.log('Citus not enabled; skipping distribution of ext_storage_* tables');
  }

  await knex.schema.raw(`
    CREATE INDEX IF NOT EXISTS ext_storage_records_namespace_idx
      ON ext_storage_records (tenant, extension_install_id, namespace, key);
  `);
  await knex.schema.raw(`
    CREATE INDEX IF NOT EXISTS ext_storage_records_ttl_idx
      ON ext_storage_records (tenant, extension_install_id, namespace, key)
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

// Run outside a transaction to support Citus DDL if enabled
exports.config = { transaction: false };
