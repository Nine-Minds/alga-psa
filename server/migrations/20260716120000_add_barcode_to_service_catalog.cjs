/**
 * Add an optional barcode to product catalog entries.
 */

exports.up = async function up(knex) {
  await knex.schema.alterTable('service_catalog', (table) => {
    table.text('barcode').nullable();
  });

  await knex.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS service_catalog_product_barcode_unique
    ON service_catalog (tenant, barcode)
    WHERE barcode IS NOT NULL AND item_kind = 'product';
  `);
};

exports.down = async function down(knex) {
  await knex.raw(`
    DROP INDEX IF EXISTS service_catalog_product_barcode_unique;
  `);

  await knex.schema.alterTable('service_catalog', (table) => {
    table.dropColumn('barcode');
  });
};
