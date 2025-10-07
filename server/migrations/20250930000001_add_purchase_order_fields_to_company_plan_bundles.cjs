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

exports.up = async function up(knex) {
  await ensureSequentialMode(knex);

  const hasPoNumber = await columnExists(knex, 'company_plan_bundles', 'po_number');
  const hasPoAmount = await columnExists(knex, 'company_plan_bundles', 'po_amount');
  const hasPoRequired = await columnExists(knex, 'company_plan_bundles', 'po_required');

  if (!hasPoNumber || !hasPoAmount || !hasPoRequired) {
    await knex.schema.alterTable('company_plan_bundles', (table) => {
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
      await knex.raw(`
        CREATE INDEX IF NOT EXISTS idx_company_plan_bundles_po_number
        ON company_plan_bundles(tenant, po_number)
        WHERE po_number IS NOT NULL;
      `);
    }

    // Add constraint to ensure po_amount is positive when provided
    await knex.raw(`
      ALTER TABLE company_plan_bundles
      DROP CONSTRAINT IF EXISTS chk_company_plan_bundles_positive_po_amount;
    `);
    await knex.raw(`
      ALTER TABLE company_plan_bundles
      ADD CONSTRAINT chk_company_plan_bundles_positive_po_amount
      CHECK (po_amount IS NULL OR po_amount >= 0);
    `);

    // Add comments for documentation
    await knex.raw(`
      COMMENT ON COLUMN company_plan_bundles.po_number IS 'Purchase Order number associated with this contract';
    `);
    await knex.raw(`
      COMMENT ON COLUMN company_plan_bundles.po_amount IS 'Purchase Order amount in cents';
    `);
    await knex.raw(`
      COMMENT ON COLUMN company_plan_bundles.po_required IS 'Whether a PO is required for invoice generation';
    `);

    console.log('Added Purchase Order fields to company_plan_bundles table');
  } else {
    console.log('Purchase Order fields already exist in company_plan_bundles table, skipping');
  }
};

exports.down = async function down(knex) {
  await ensureSequentialMode(knex);

  const hasPoNumber = await columnExists(knex, 'company_plan_bundles', 'po_number');
  const hasPoAmount = await columnExists(knex, 'company_plan_bundles', 'po_amount');
  const hasPoRequired = await columnExists(knex, 'company_plan_bundles', 'po_required');

  if (hasPoNumber || hasPoAmount || hasPoRequired) {
    // Drop index
    await knex.raw(`
      DROP INDEX IF EXISTS idx_company_plan_bundles_po_number;
    `);

    // Drop constraint
    await knex.raw(`
      ALTER TABLE company_plan_bundles
      DROP CONSTRAINT IF EXISTS chk_company_plan_bundles_positive_po_amount;
    `);

    // Drop columns
    await knex.schema.alterTable('company_plan_bundles', (table) => {
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

    console.log('Removed Purchase Order fields from company_plan_bundles table');
  }
};

exports.config = { transaction: false };
