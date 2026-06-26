/**
 * Inventory module — foundation tables: stock_locations + vendors.
 *
 * - stock_locations: where stock physically lives (warehouse/van/office). One default per tenant.
 * - vendors: first-class supplier entity replacing the freeform service_catalog.vendor text.
 *   Backfills distinct freeform vendor strings into vendors.
 * - Seeds one default location per existing tenant.
 *
 * See ee/docs/plans/2026-06-26-inventory-module/ and docs/plans/2026-06-26-inventory-module-design.md (§4).
 */

exports.up = async function up(knex) {
  await knex.schema.createTable('stock_locations', (table) => {
    table.uuid('tenant').notNullable();
    table.uuid('location_id').defaultTo(knex.raw('gen_random_uuid()')).notNullable();
    table.text('name').notNullable();
    table.text('location_type').notNullable().defaultTo('warehouse');
    table.uuid('assigned_user_id').nullable(); // van stock tied to a tech
    table.uuid('manager_user_id').nullable();  // receives this location's low-stock alerts
    table.boolean('is_default').notNullable().defaultTo(false);
    table.boolean('is_active').notNullable().defaultTo(true);
    table.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
    table.timestamp('updated_at', { useTz: true }).defaultTo(knex.fn.now());

    table.primary(['tenant', 'location_id']);
    table.foreign('tenant').references('tenants.tenant');
    table.foreign(['tenant', 'assigned_user_id']).references(['tenant', 'user_id']).inTable('users');
    table.foreign(['tenant', 'manager_user_id']).references(['tenant', 'user_id']).inTable('users');
    table.unique(['tenant', 'name']);
  });

  await knex.raw(`
    ALTER TABLE stock_locations
    ADD CONSTRAINT stock_locations_type_check
    CHECK (location_type IN ('warehouse','van','office','other'))
  `);

  // Exactly one default location per tenant
  await knex.raw(`
    CREATE UNIQUE INDEX idx_stock_locations_one_default
    ON stock_locations (tenant)
    WHERE is_default = true
  `);

  await knex.schema.createTable('vendors', (table) => {
    table.uuid('tenant').notNullable();
    table.uuid('vendor_id').defaultTo(knex.raw('gen_random_uuid()')).notNullable();
    table.text('vendor_name').notNullable();
    table.text('contact_name').nullable();
    table.text('email').nullable();
    table.text('phone').nullable();
    table.text('website').nullable();
    table.text('payment_terms').nullable();
    table.text('account_number').nullable();
    table.text('notes').nullable();
    table.boolean('is_active').notNullable().defaultTo(true);
    table.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
    table.timestamp('updated_at', { useTz: true }).defaultTo(knex.fn.now());

    table.primary(['tenant', 'vendor_id']);
    table.foreign('tenant').references('tenants.tenant');
    table.unique(['tenant', 'vendor_name']);
  });

  // Seed one default location per existing tenant
  await knex.raw(`
    INSERT INTO stock_locations (tenant, location_id, name, location_type, is_default, is_active)
    SELECT t.tenant, gen_random_uuid(), 'Main Warehouse', 'warehouse', true, true
    FROM tenants t
    WHERE NOT EXISTS (
      SELECT 1 FROM stock_locations sl WHERE sl.tenant = t.tenant AND sl.is_default = true
    )
  `);

  // Backfill vendors from distinct freeform service_catalog.vendor values
  await knex.raw(`
    INSERT INTO vendors (tenant, vendor_id, vendor_name, is_active)
    SELECT d.tenant, gen_random_uuid(), d.vendor_name, true
    FROM (
      SELECT DISTINCT tenant, btrim(vendor) AS vendor_name
      FROM service_catalog
      WHERE vendor IS NOT NULL AND btrim(vendor) <> ''
    ) d
    ON CONFLICT (tenant, vendor_name) DO NOTHING
  `);
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('vendors');
  await knex.raw('DROP INDEX IF EXISTS idx_stock_locations_one_default');
  await knex.schema.dropTableIfExists('stock_locations');
};
