/**
 * Inventory module — asset-to-product linkage.
 * Adds service_id (product the asset was sold from) and stock_unit_id (the physical unit)
 * to the existing assets table. Both nullable; MAC/serial/warranty are surfaced via the unit link.
 */

exports.up = async function up(knex) {
  const hasService = await knex.schema.hasColumn('assets', 'service_id');
  const hasUnit = await knex.schema.hasColumn('assets', 'stock_unit_id');

  await knex.schema.alterTable('assets', (table) => {
    if (!hasService) table.uuid('service_id').nullable();
    if (!hasUnit) table.uuid('stock_unit_id').nullable();
  });

  if (!hasService) {
    await knex.schema.alterTable('assets', (table) => {
      table.foreign(['tenant', 'service_id']).references(['tenant', 'service_id']).inTable('service_catalog');
    });
  }
  if (!hasUnit) {
    await knex.schema.alterTable('assets', (table) => {
      table.foreign(['tenant', 'stock_unit_id']).references(['tenant', 'unit_id']).inTable('stock_units');
    });
    await knex.raw(`CREATE INDEX IF NOT EXISTS idx_assets_stock_unit ON assets (tenant, stock_unit_id)`);
  }
};

exports.down = async function down(knex) {
  await knex.raw('DROP INDEX IF EXISTS idx_assets_stock_unit');
  await knex.schema.alterTable('assets', (table) => {
    table.dropForeign(['tenant', 'service_id']);
    table.dropForeign(['tenant', 'stock_unit_id']);
  });
  await knex.schema.alterTable('assets', (table) => {
    table.dropColumn('service_id');
    table.dropColumn('stock_unit_id');
  });
};
