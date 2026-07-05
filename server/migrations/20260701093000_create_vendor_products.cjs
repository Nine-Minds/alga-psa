/**
 * Vendor price lists (remediation plan F052): per-(vendor, product) offer carrying
 * the DISTRIBUTOR's part number and contract cost — how an MSP actually orders.
 * One offer per product may be preferred (partial unique), and PO lines gain a
 * vendor_sku snapshot so the paperwork shows the number the vendor recognizes.
 */

const { ensureTenantDistribution } = require('./utils/citusDistribution.cjs');

exports.up = async function up(knex) {
  await knex.schema.createTable('vendor_products', (t) => {
    t.uuid('tenant').notNullable();
    t.uuid('vendor_id').notNullable();
    t.uuid('service_id').notNullable();
    t.text('vendor_sku').nullable();
    t.bigInteger('unit_cost').nullable(); // cents
    t.text('cost_currency').notNullable().defaultTo('USD');
    t.integer('lead_time_days').nullable();
    t.boolean('is_preferred').notNullable().defaultTo(false);
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());

    t.primary(['tenant', 'vendor_id', 'service_id']);
    t.foreign(['tenant', 'vendor_id'], 'fk_vendor_products_vendor')
      .references(['tenant', 'vendor_id'])
      .inTable('vendors')
      .onDelete('CASCADE');
    t.foreign(['tenant', 'service_id'], 'fk_vendor_products_service')
      .references(['tenant', 'service_id'])
      .inTable('service_catalog')
      .onDelete('CASCADE');
    t.index(['tenant', 'service_id'], 'idx_vendor_products_service');
  });

  // Distribute on Citus (colocated with tenants).
  await ensureTenantDistribution(knex, 'vendor_products');

  // One preferred offer per (tenant, product) — DB-enforced like the default location.
  await knex.raw(`
    CREATE UNIQUE INDEX idx_vendor_products_one_preferred
      ON vendor_products (tenant, service_id) WHERE is_preferred = true
  `);

  await knex.schema.alterTable('purchase_order_lines', (t) => {
    t.text('vendor_sku').nullable();
  });
};

exports.down = async function down(knex) {
  await knex.schema.alterTable('purchase_order_lines', (t) => {
    t.dropColumn('vendor_sku');
  });
  await knex.schema.dropTableIfExists('vendor_products');
};

exports.config = { transaction: false };
