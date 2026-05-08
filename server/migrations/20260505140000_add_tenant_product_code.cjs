/**
 * Add product entitlement to tenants.
 *
 * - Adds tenants.product_code with DEFAULT 'psa' (existing rows backfilled by DEFAULT)
 * - Backfills any pre-existing NULL/empty rows to 'psa' (recovery path)
 * - Enforces allowed values via CHECK + IS NOT NULL
 *
 * Note: avoids `ALTER COLUMN ... SET NOT NULL` on the distributed `tenants`
 * table — that previously failed in production. The CHECK constraint includes
 * `IS NOT NULL`, which gives the same guarantee without the problematic alter.
 */
exports.up = async function up(knex) {
  const hasColumn = await knex.schema.hasColumn('tenants', 'product_code');

  if (!hasColumn) {
    // PostgreSQL applies the DEFAULT to existing rows when adding the column,
    // so no separate backfill is needed in the fresh-add case.
    await knex.raw(`
      ALTER TABLE tenants
      ADD COLUMN product_code text DEFAULT 'psa'
    `);
  } else {
    // Column exists from the previous failed run. Make sure DEFAULT is set
    // and clean up any lingering NULL/empty values.
    await knex.raw(`
      ALTER TABLE tenants
      ALTER COLUMN product_code SET DEFAULT 'psa'
    `);

    await knex.raw(`
      UPDATE tenants
      SET product_code = 'psa'
      WHERE product_code IS NULL OR product_code = ''
    `);
  }

  await knex.raw(`
    ALTER TABLE tenants
    DROP CONSTRAINT IF EXISTS tenants_product_code_check
  `);

  // CHECK + IS NOT NULL replaces the column-level NOT NULL constraint.
  await knex.raw(`
    ALTER TABLE tenants
    ADD CONSTRAINT tenants_product_code_check
    CHECK (product_code IS NOT NULL AND product_code IN ('psa', 'algadesk'))
  `);
};

exports.down = async function down(knex) {
  const hasColumn = await knex.schema.hasColumn('tenants', 'product_code');

  if (!hasColumn) {
    return;
  }

  await knex.raw(`
    ALTER TABLE tenants
    DROP CONSTRAINT IF EXISTS tenants_product_code_check
  `);

  await knex.schema.alterTable('tenants', (table) => {
    table.dropColumn('product_code');
  });
};
