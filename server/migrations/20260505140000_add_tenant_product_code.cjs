/**
 * Add product entitlement to tenants.
 *
 * - Adds tenants.product_code
 * - Backfills NULL/empty rows to 'psa'
 * - Enforces allowed values: psa | algadesk
 */
exports.up = async function up(knex) {
  const hasColumn = await knex.schema.hasColumn('tenants', 'product_code');

  if (!hasColumn) {
    await knex.schema.alterTable('tenants', (table) => {
      table.text('product_code').nullable();
    });
  }

  await knex('tenants')
    .whereNull('product_code')
    .orWhere('product_code', '')
    .update({ product_code: 'psa' });

  await knex.raw(`
    ALTER TABLE tenants
    DROP CONSTRAINT IF EXISTS tenants_product_code_check
  `);

  await knex.raw(`
    ALTER TABLE tenants
    ADD CONSTRAINT tenants_product_code_check
    CHECK (product_code IN ('psa', 'algadesk'))
  `);

  await knex.schema.alterTable('tenants', (table) => {
    table.text('product_code').notNullable().defaultTo('psa').alter();
  });
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
