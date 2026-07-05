/**
 * Inventory module — sales: sales_orders + sales_order_lines (outbound mirror of PO).
 * Seeds SALES_ORDER numbering (prefix 'SO') via the next_number table.
 *
 * parent_so_line_id is a soft self-reference used to group exploded kit-component lines
 * under their kit parent line.
 */

const { ensureTenantDistribution } = require('./utils/citusDistribution.cjs');

exports.up = async function up(knex) {
  await knex.schema.createTable('sales_orders', (table) => {
    table.uuid('tenant').notNullable();
    table.uuid('so_id').defaultTo(knex.raw('gen_random_uuid()')).notNullable();
    table.text('so_number').notNullable();
    table.uuid('client_id').notNullable();
    table.text('status').notNullable().defaultTo('draft');
    table.timestamp('order_date', { useTz: true }).nullable();
    table.timestamp('expected_ship_date', { useTz: true }).nullable();
    table.jsonb('ship_to').nullable();
    table.text('currency_code').notNullable().defaultTo('USD');
    table.text('client_po_number').nullable();
    table.text('invoice_mode').notNullable().defaultTo('on_fulfillment');
    table.text('allocation_mode').notNullable().defaultTo('soft');
    table.text('notes').nullable();
    table.uuid('created_by').nullable();
    table.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
    table.timestamp('updated_at', { useTz: true }).defaultTo(knex.fn.now());

    table.primary(['tenant', 'so_id']);
    table.foreign('tenant').references('tenants.tenant');
    table.foreign(['tenant', 'client_id']).references(['tenant', 'client_id']).inTable('clients').onDelete('RESTRICT');
    table.foreign(['tenant', 'created_by']).references(['tenant', 'user_id']).inTable('users');
    table.unique(['tenant', 'so_number']);
  });

  await knex.raw(`
    ALTER TABLE sales_orders
    ADD CONSTRAINT sales_orders_status_check
    CHECK (status IN ('draft','confirmed','partially_fulfilled','fulfilled','invoiced','closed','cancelled'))
  `);
  await knex.raw(`
    ALTER TABLE sales_orders
    ADD CONSTRAINT sales_orders_invoice_mode_check
    CHECK (invoice_mode IN ('on_fulfillment','manual'))
  `);
  await knex.raw(`
    ALTER TABLE sales_orders
    ADD CONSTRAINT sales_orders_allocation_mode_check
    CHECK (allocation_mode IN ('soft','hard'))
  `);

  await knex.schema.createTable('sales_order_lines', (table) => {
    table.uuid('tenant').notNullable();
    table.uuid('so_line_id').defaultTo(knex.raw('gen_random_uuid()')).notNullable();
    table.uuid('so_id').notNullable();
    table.uuid('service_id').notNullable();
    table.integer('quantity_ordered').notNullable();
    table.integer('quantity_fulfilled').notNullable().defaultTo(0);
    table.integer('quantity_invoiced').notNullable().defaultTo(0);
    table.bigInteger('unit_price').notNullable().defaultTo(0); // cents
    table.bigInteger('cost_snapshot').nullable(); // cents
    table.uuid('tax_rate_id').nullable();
    table.text('fulfillment_type').notNullable().defaultTo('from_stock');
    table.uuid('parent_so_line_id').nullable(); // soft self-ref (kit explosion)
    table.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
    table.timestamp('updated_at', { useTz: true }).defaultTo(knex.fn.now());

    table.primary(['tenant', 'so_line_id']);
    table.foreign('tenant').references('tenants.tenant');
    table.foreign(['tenant', 'so_id']).references(['tenant', 'so_id']).inTable('sales_orders').onDelete('CASCADE');
    table.foreign(['tenant', 'service_id']).references(['tenant', 'service_id']).inTable('service_catalog').onDelete('RESTRICT');
  });

  await knex.raw(`
    ALTER TABLE sales_order_lines
    ADD CONSTRAINT sales_order_lines_fulfillment_check
    CHECK (fulfillment_type IN ('from_stock','drop_ship'))
  `);
  await knex.raw(`CREATE INDEX idx_so_lines_so ON sales_order_lines (tenant, so_id)`);

  // Distribute on Citus (colocated with tenants), parent-first.
  await ensureTenantDistribution(knex, 'sales_orders');
  await ensureTenantDistribution(knex, 'sales_order_lines');

  // Seed SALES_ORDER numbering for all existing tenants (prefix SO, padding 5)
  await knex.raw(`
    INSERT INTO next_number (tenant, entity_type, last_number, initial_value, prefix, padding_length)
    SELECT tenant, 'SALES_ORDER', 0, 1, 'SO', 5
    FROM tenants
    ON CONFLICT (tenant, entity_type) DO NOTHING
  `);
};

exports.down = async function down(knex) {
  await knex('next_number').where({ entity_type: 'SALES_ORDER' }).del();
  await knex.raw('DROP INDEX IF EXISTS idx_so_lines_so');
  await knex.schema.dropTableIfExists('sales_order_lines');
  await knex.schema.dropTableIfExists('sales_orders');
};

exports.config = { transaction: false };
