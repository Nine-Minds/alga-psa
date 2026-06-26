/**
 * Inventory module — procurement: purchase_orders + purchase_order_lines.
 * Seeds PURCHASE_ORDER numbering (prefix 'PO') via the next_number table,
 * patterned after invoice/ticket/project/quote numbering.
 */

exports.up = async function up(knex) {
  await knex.schema.createTable('purchase_orders', (table) => {
    table.uuid('tenant').notNullable();
    table.uuid('po_id').defaultTo(knex.raw('gen_random_uuid()')).notNullable();
    table.text('po_number').notNullable();
    table.uuid('vendor_id').notNullable();
    table.text('status').notNullable().defaultTo('draft');
    table.timestamp('order_date', { useTz: true }).nullable();
    table.timestamp('expected_date', { useTz: true }).nullable();
    table.uuid('ship_to_location_id').nullable();
    table.boolean('is_drop_ship').notNullable().defaultTo(false);
    table.uuid('drop_ship_client_id').nullable();
    table.jsonb('drop_ship_address').nullable();
    table.text('currency_code').notNullable().defaultTo('USD');
    table.text('notes').nullable();
    table.uuid('created_by').nullable();
    table.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
    table.timestamp('updated_at', { useTz: true }).defaultTo(knex.fn.now());

    table.primary(['tenant', 'po_id']);
    table.foreign('tenant').references('tenants.tenant');
    table.foreign(['tenant', 'vendor_id']).references(['tenant', 'vendor_id']).inTable('vendors').onDelete('RESTRICT');
    table.foreign(['tenant', 'ship_to_location_id']).references(['tenant', 'location_id']).inTable('stock_locations');
    table.foreign(['tenant', 'drop_ship_client_id']).references(['tenant', 'client_id']).inTable('clients');
    table.foreign(['tenant', 'created_by']).references(['tenant', 'user_id']).inTable('users');
    table.unique(['tenant', 'po_number']);
  });

  await knex.raw(`
    ALTER TABLE purchase_orders
    ADD CONSTRAINT purchase_orders_status_check
    CHECK (status IN ('draft','open','partially_received','received','cancelled'))
  `);

  await knex.schema.createTable('purchase_order_lines', (table) => {
    table.uuid('tenant').notNullable();
    table.uuid('po_line_id').defaultTo(knex.raw('gen_random_uuid()')).notNullable();
    table.uuid('po_id').notNullable();
    table.uuid('service_id').notNullable();
    table.integer('quantity_ordered').notNullable();
    table.integer('quantity_received').notNullable().defaultTo(0);
    table.bigInteger('unit_cost').notNullable().defaultTo(0); // cents
    table.text('cost_currency').notNullable().defaultTo('USD');
    table.uuid('source_so_line_id').nullable(); // soft link (backorder/drop-ship)
    table.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
    table.timestamp('updated_at', { useTz: true }).defaultTo(knex.fn.now());

    table.primary(['tenant', 'po_line_id']);
    table.foreign('tenant').references('tenants.tenant');
    table.foreign(['tenant', 'po_id']).references(['tenant', 'po_id']).inTable('purchase_orders').onDelete('CASCADE');
    table.foreign(['tenant', 'service_id']).references(['tenant', 'service_id']).inTable('service_catalog').onDelete('RESTRICT');
  });

  await knex.raw(`CREATE INDEX idx_po_lines_po ON purchase_order_lines (tenant, po_id)`);

  // Seed PURCHASE_ORDER numbering for all existing tenants (prefix PO, padding 5)
  await knex.raw(`
    INSERT INTO next_number (tenant, entity_type, last_number, initial_value, prefix, padding_length)
    SELECT tenant, 'PURCHASE_ORDER', 0, 1, 'PO', 5
    FROM tenants
    ON CONFLICT (tenant, entity_type) DO NOTHING
  `);
};

exports.down = async function down(knex) {
  await knex('next_number').where({ entity_type: 'PURCHASE_ORDER' }).del();
  await knex.raw('DROP INDEX IF EXISTS idx_po_lines_po');
  await knex.schema.dropTableIfExists('purchase_order_lines');
  await knex.schema.dropTableIfExists('purchase_orders');
};
