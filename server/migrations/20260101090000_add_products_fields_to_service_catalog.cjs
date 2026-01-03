/**
 * Add Products support as a subset/view of service_catalog by introducing item_kind and product fields.
 *
 * V1 scope:
 * - Products are catalog items where item_kind = 'product'
 * - Licenses are modeled as product metadata (term/cadence), not separate period/proration semantics yet
 */

exports.up = async function up(knex) {
  await knex.schema.alterTable('service_catalog', (table) => {
    table
      .text('item_kind')
      .notNullable()
      .defaultTo('service');

    table.boolean('is_active').notNullable().defaultTo(true);

    table.text('sku').nullable();
    table.bigInteger('cost').nullable(); // cents in tenant currency
    table.text('vendor').nullable();
    table.text('manufacturer').nullable();
    table.text('product_category').nullable();

    // License term metadata (no start/end/proration in V1)
    table.boolean('is_license').notNullable().defaultTo(false);
    table.text('license_term').nullable(); // e.g. monthly|annual|perpetual
    table.text('license_billing_cadence').nullable(); // e.g. monthly|annual
  });

  await knex.raw(`
    ALTER TABLE service_catalog
    ADD CONSTRAINT service_catalog_item_kind_check
    CHECK (item_kind IN ('service', 'product'));
  `);

  await knex.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS service_catalog_product_sku_unique
    ON service_catalog (tenant, sku)
    WHERE sku IS NOT NULL AND item_kind = 'product';
  `);

  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_service_catalog_item_kind
    ON service_catalog (tenant, item_kind);
  `);

  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_service_catalog_product_name
    ON service_catalog (tenant, service_name)
    WHERE item_kind = 'product';
  `);
};

exports.down = async function down(knex) {
  await knex.raw(`
    DROP INDEX IF EXISTS idx_service_catalog_product_name;
  `);
  await knex.raw(`
    DROP INDEX IF EXISTS idx_service_catalog_item_kind;
  `);
  await knex.raw(`
    DROP INDEX IF EXISTS service_catalog_product_sku_unique;
  `);

  await knex.raw(`
    ALTER TABLE service_catalog
    DROP CONSTRAINT IF EXISTS service_catalog_item_kind_check;
  `);

  await knex.schema.alterTable('service_catalog', (table) => {
    table.dropColumn('license_billing_cadence');
    table.dropColumn('license_term');
    table.dropColumn('is_license');
    table.dropColumn('product_category');
    table.dropColumn('manufacturer');
    table.dropColumn('vendor');
    table.dropColumn('cost');
    table.dropColumn('sku');
    table.dropColumn('is_active');
    table.dropColumn('item_kind');
  });
};

