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

const columnExists = async (knex, tableName, columnName) => {
  const result = await knex.schema.hasColumn(tableName, columnName);
  return result;
};

const getExistingBundleTable = async (knex) => {
  // Check for new terminology first (post-rename migration)
  const hasClientContracts = await knex.schema.hasTable('client_contracts');
  if (hasClientContracts) return 'client_contracts';

  // Fallback to legacy names if they still exist (pre-rename migration)
  const hasCompany = await knex.schema.hasTable('company_plan_bundles');
  if (hasCompany) return 'company_plan_bundles';
  const hasClient = await knex.schema.hasTable('client_plan_bundles');
  if (hasClient) return 'client_plan_bundles';
  return null;
};

exports.up = async function up(knex) {
  await ensureSequentialMode(knex);

  const tableName = await getExistingBundleTable(knex);
  if (!tableName) {
    console.log('⊘ Skipping PO field addition: no contracts table found (client_contracts or legacy bundle tables)');
    return;
  }

  const hasPoNumber = await columnExists(knex, tableName, 'po_number');
  const hasPoAmount = await columnExists(knex, tableName, 'po_amount');
  const hasPoRequired = await columnExists(knex, tableName, 'po_required');

  if (!hasPoNumber || !hasPoAmount || !hasPoRequired) {
    await knex.schema.alterTable(tableName, (table) => {
      if (!hasPoNumber) {
        table.text('po_number');
      }
      if (!hasPoAmount) {
        table.bigInteger('po_amount');
      }
      if (!hasPoRequired) {
        table.boolean('po_required').defaultTo(false);
      }
    });

    // Add index for PO number lookups
    if (!hasPoNumber) {
      const indexName = `idx_${tableName}_po_number`;
      await knex.raw(`
        CREATE INDEX IF NOT EXISTS ${indexName}
        ON ${tableName}(tenant, po_number)
        WHERE po_number IS NOT NULL;
      `);
    }

    // Add constraint to ensure po_amount is positive when provided
    const constraintName = `chk_${tableName}_positive_po_amount`;
    await knex.raw(`
      ALTER TABLE ${tableName}
      DROP CONSTRAINT IF EXISTS ${constraintName};
    `);
    await knex.raw(`
      ALTER TABLE ${tableName}
      ADD CONSTRAINT ${constraintName}
      CHECK (po_amount IS NULL OR po_amount >= 0);
    `);

    // Add comments for documentation
    await knex.raw(`
      COMMENT ON COLUMN ${tableName}.po_number IS 'Purchase Order number associated with this contract';
    `);
    await knex.raw(`
      COMMENT ON COLUMN ${tableName}.po_amount IS 'Purchase Order amount in cents';
    `);
    await knex.raw(`
      COMMENT ON COLUMN ${tableName}.po_required IS 'Whether a PO is required for invoice generation';
    `);

    console.log(`Added Purchase Order fields to ${tableName} table`);
  } else {
    console.log(`Purchase Order fields already exist in ${tableName} table, skipping`);
  }
};

exports.down = async function down(knex) {
  await ensureSequentialMode(knex);

  // Determine which table has the PO columns to remove
  const tables = ['client_contracts', 'company_plan_bundles', 'client_plan_bundles'];
  let tableName = null;
  for (const t of tables) {
    const exists = await knex.schema.hasTable(t);
    if (!exists) continue;
    const anyColumn = await knex.schema.hasColumn(t, 'po_number') ||
                      await knex.schema.hasColumn(t, 'po_amount') ||
                      await knex.schema.hasColumn(t, 'po_required');
    if (anyColumn) { tableName = t; break; }
  }

  if (!tableName) {
    console.log('⊘ No PO fields found on contracts tables, nothing to roll back');
    return;
  }

  const hasPoNumber = await columnExists(knex, tableName, 'po_number');
  const hasPoAmount = await columnExists(knex, tableName, 'po_amount');
  const hasPoRequired = await columnExists(knex, tableName, 'po_required');

  if (hasPoNumber || hasPoAmount || hasPoRequired) {
    // Drop index
    const indexName = `idx_${tableName}_po_number`;
    await knex.raw(`
      DROP INDEX IF EXISTS ${indexName};
    `);

    // Drop constraint
    const constraintName = `chk_${tableName}_positive_po_amount`;
    await knex.raw(`
      ALTER TABLE ${tableName}
      DROP CONSTRAINT IF EXISTS ${constraintName};
    `);

    // Drop columns
    await knex.schema.alterTable(tableName, (table) => {
      if (hasPoNumber) {
        table.dropColumn('po_number');
      }
      if (hasPoAmount) {
        table.dropColumn('po_amount');
      }
      if (hasPoRequired) {
        table.dropColumn('po_required');
      }
    });

    console.log(`Removed Purchase Order fields from ${tableName} table`);
  }
};

exports.config = { transaction: false };
