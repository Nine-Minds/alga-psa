const ensureSequentialMode = async (knex) => {
  await knex.raw(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM pg_extension WHERE extname = 'citus'
      ) THEN
        EXECUTE 'SET citus.multi_shard_modify_mode TO ''sequential''';
      END IF;
    END $$;
  `);
};

const hasColumn = async (knex, table, column) => {
  try {
    return await knex.schema.hasColumn(table, column);
  } catch (error) {
    console.warn(`Unable to check column ${column} on ${table}:`, error);
    return false;
  }
};

exports.up = async function up(knex) {
  await ensureSequentialMode(knex);

  const tableName = 'client_contracts';
  const tableExists = await knex.schema.hasTable(tableName);
  if (!tableExists) {
    console.log('⊘ Skipping client contract PO migration: client_contracts table not found');
    return;
  }

  const [poNumberExists, poRequiredExists] = await Promise.all([
    hasColumn(knex, tableName, 'po_number'),
    hasColumn(knex, tableName, 'po_required'),
  ]);

  if (!poNumberExists || !poRequiredExists) {
    await knex.schema.alterTable(tableName, (table) => {
      if (!poNumberExists) {
        table.text('po_number');
      }
      if (!poRequiredExists) {
        table.boolean('po_required').notNullable().defaultTo(false);
      }
    });

    if (!poNumberExists) {
      const indexName = `idx_${tableName}_po_number`;
      await knex.raw(`
        CREATE INDEX IF NOT EXISTS ${indexName}
        ON ${tableName}(tenant, po_number)
        WHERE po_number IS NOT NULL;
      `);
    }

    await knex.raw(`
      COMMENT ON COLUMN ${tableName}.po_number IS 'Purchase Order number associated with this client contract';
    `);
    await knex.raw(`
      COMMENT ON COLUMN ${tableName}.po_required IS 'Whether a Purchase Order is required for invoicing under this contract';
    `);

    console.log('✓ Added Purchase Order support columns to client_contracts');
  } else {
    console.log('⊘ Purchase Order columns already present on client_contracts, skipping');
  }
};

exports.down = async function down(knex) {
  await ensureSequentialMode(knex);

  const tableName = 'client_contracts';
  const tableExists = await knex.schema.hasTable(tableName);
  if (!tableExists) {
    console.log('⊘ client_contracts table not found, nothing to roll back');
    return;
  }

  const [poNumberExists, poRequiredExists] = await Promise.all([
    hasColumn(knex, tableName, 'po_number'),
    hasColumn(knex, tableName, 'po_required'),
  ]);

  if (!poNumberExists && !poRequiredExists) {
    console.log('⊘ Purchase Order columns already absent, nothing to roll back');
    return;
  }

  if (poNumberExists) {
    const indexName = `idx_${tableName}_po_number`;
    await knex.raw(`DROP INDEX IF EXISTS ${indexName};`);
  }

  await knex.schema.alterTable(tableName, (table) => {
    if (poNumberExists) {
      table.dropColumn('po_number');
    }
    if (poRequiredExists) {
      table.dropColumn('po_required');
    }
  });

  console.log('✓ Removed Purchase Order columns from client_contracts');
};

exports.config = { transaction: false };
