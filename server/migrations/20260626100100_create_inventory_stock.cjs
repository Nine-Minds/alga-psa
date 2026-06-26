/**
 * Inventory module — catalog opt-in + stock truth.
 *
 * - product_inventory_settings: 1:1 opt-in bridge to service_catalog (flags, reorder, avg cost, kit pricing).
 * - stock_levels: (product × location) on-hand/reserved/held balance cache.
 * - stock_units: one row per serialized physical unit (serial + MAC + warranty), the asset/RMA bridge.
 * - stock_movements: immutable append-only ledger (source of truth).
 * - kit_components: a kit's single-level bill of materials.
 *
 * Cross-document pointers (allocated_so_line_id, source_po_id) are intentionally soft (no DB FK)
 * to avoid circular table-creation ordering; the order tables are created in later migrations.
 */

exports.up = async function up(knex) {
  // --- product_inventory_settings ---
  await knex.schema.createTable('product_inventory_settings', (table) => {
    table.uuid('tenant').notNullable();
    table.uuid('service_id').notNullable();
    table.boolean('track_stock').notNullable().defaultTo(true);
    table.boolean('is_serialized').notNullable().defaultTo(false);
    table.boolean('is_kit').notNullable().defaultTo(false);
    table.boolean('creates_asset_on_delivery').notNullable().defaultTo(false);
    table.integer('reorder_point').nullable();
    table.integer('reorder_quantity').nullable();
    table.bigInteger('average_cost').nullable(); // cents
    table.text('cost_currency').notNullable().defaultTo('USD');
    table.text('kit_pricing_mode').notNullable().defaultTo('sum'); // 'sum' | 'fixed'
    table.bigInteger('kit_fixed_price').nullable(); // cents, used when kit_pricing_mode='fixed'
    table.uuid('default_location_id').nullable();
    table.uuid('preferred_vendor_id').nullable();
    table.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
    table.timestamp('updated_at', { useTz: true }).defaultTo(knex.fn.now());

    table.primary(['tenant', 'service_id']);
    table.foreign('tenant').references('tenants.tenant');
    table.foreign(['tenant', 'service_id']).references(['tenant', 'service_id']).inTable('service_catalog').onDelete('CASCADE');
    table.foreign(['tenant', 'default_location_id']).references(['tenant', 'location_id']).inTable('stock_locations');
    table.foreign(['tenant', 'preferred_vendor_id']).references(['tenant', 'vendor_id']).inTable('vendors');
  });

  await knex.raw(`
    ALTER TABLE product_inventory_settings
    ADD CONSTRAINT product_inventory_settings_kit_pricing_check
    CHECK (kit_pricing_mode IN ('sum','fixed'))
  `);

  // --- stock_levels ---
  await knex.schema.createTable('stock_levels', (table) => {
    table.uuid('tenant').notNullable();
    table.uuid('service_id').notNullable();
    table.uuid('location_id').notNullable();
    table.integer('quantity_on_hand').notNullable().defaultTo(0);
    table.integer('reserved_quantity').notNullable().defaultTo(0);
    table.integer('held_quantity').notNullable().defaultTo(0);
    table.integer('reorder_point').nullable(); // per-location override
    table.timestamp('updated_at', { useTz: true }).defaultTo(knex.fn.now());

    table.primary(['tenant', 'service_id', 'location_id']);
    table.foreign('tenant').references('tenants.tenant');
    table.foreign(['tenant', 'service_id']).references(['tenant', 'service_id']).inTable('service_catalog').onDelete('RESTRICT');
    table.foreign(['tenant', 'location_id']).references(['tenant', 'location_id']).inTable('stock_locations').onDelete('RESTRICT');
  });

  // --- stock_units ---
  await knex.schema.createTable('stock_units', (table) => {
    table.uuid('tenant').notNullable();
    table.uuid('unit_id').defaultTo(knex.raw('gen_random_uuid()')).notNullable();
    table.uuid('service_id').notNullable();
    table.text('serial_number').notNullable();
    table.text('mac_address').nullable();
    table.text('status').notNullable().defaultTo('in_stock');
    table.uuid('location_id').nullable();
    table.uuid('client_id').nullable();
    table.uuid('asset_id').nullable();
    table.uuid('allocated_so_line_id').nullable(); // soft link (sales_order_lines created later)
    table.timestamp('warranty_expires_at', { useTz: true }).nullable();
    table.text('warranty_term').nullable();
    table.timestamp('loan_due_at', { useTz: true }).nullable();
    table.bigInteger('unit_cost').nullable(); // cents
    table.text('cost_currency').notNullable().defaultTo('USD');
    table.timestamp('received_at', { useTz: true }).nullable();
    table.timestamp('delivered_at', { useTz: true }).nullable();
    table.uuid('source_po_id').nullable(); // soft link (purchase_orders created later)
    table.text('notes').nullable();
    table.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
    table.timestamp('updated_at', { useTz: true }).defaultTo(knex.fn.now());

    table.primary(['tenant', 'unit_id']);
    table.foreign('tenant').references('tenants.tenant');
    table.foreign(['tenant', 'service_id']).references(['tenant', 'service_id']).inTable('service_catalog').onDelete('RESTRICT');
    table.foreign(['tenant', 'location_id']).references(['tenant', 'location_id']).inTable('stock_locations');
    table.foreign(['tenant', 'client_id']).references(['tenant', 'client_id']).inTable('clients');
    table.foreign(['tenant', 'asset_id']).references(['tenant', 'asset_id']).inTable('assets');
    table.unique(['tenant', 'service_id', 'serial_number']);
  });

  await knex.raw(`
    ALTER TABLE stock_units
    ADD CONSTRAINT stock_units_status_check
    CHECK (status IN ('in_stock','allocated','in_transit','on_loan','delivered','returned','in_rma','retired'))
  `);
  // MAC is globally unique → uniqueness is tenant-wide, not per-product
  await knex.raw(`
    CREATE UNIQUE INDEX idx_stock_units_tenant_mac
    ON stock_units (tenant, mac_address)
    WHERE mac_address IS NOT NULL
  `);
  await knex.raw(`CREATE INDEX idx_stock_units_status ON stock_units (tenant, status)`);
  await knex.raw(`CREATE INDEX idx_stock_units_serial ON stock_units (tenant, serial_number)`);
  await knex.raw(`CREATE INDEX idx_stock_units_asset ON stock_units (tenant, asset_id)`);
  await knex.raw(`CREATE INDEX idx_stock_units_client ON stock_units (tenant, client_id)`);

  // --- stock_movements (append-only) ---
  await knex.schema.createTable('stock_movements', (table) => {
    table.uuid('tenant').notNullable();
    table.uuid('movement_id').defaultTo(knex.raw('gen_random_uuid()')).notNullable();
    table.text('movement_type').notNullable();
    table.uuid('service_id').notNullable();
    table.uuid('unit_id').nullable();
    table.uuid('from_location_id').nullable();
    table.uuid('to_location_id').nullable();
    table.integer('quantity').notNullable();
    table.bigInteger('unit_cost').nullable();
    table.text('cost_currency').nullable();
    table.bigInteger('cogs_cost').nullable();
    table.text('reason').nullable();
    table.text('source_doc_type').nullable();
    table.uuid('source_doc_id').nullable();
    table.uuid('performed_by').nullable();
    table.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());

    table.primary(['tenant', 'movement_id']);
    table.foreign('tenant').references('tenants.tenant');
    table.foreign(['tenant', 'service_id']).references(['tenant', 'service_id']).inTable('service_catalog').onDelete('RESTRICT');
    table.foreign(['tenant', 'unit_id']).references(['tenant', 'unit_id']).inTable('stock_units');
    table.foreign(['tenant', 'from_location_id']).references(['tenant', 'location_id']).inTable('stock_locations');
    table.foreign(['tenant', 'to_location_id']).references(['tenant', 'location_id']).inTable('stock_locations');
    table.foreign(['tenant', 'performed_by']).references(['tenant', 'user_id']).inTable('users');
  });

  await knex.raw(`
    ALTER TABLE stock_movements
    ADD CONSTRAINT stock_movements_type_check
    CHECK (movement_type IN (
      'receipt','consume','adjust','transfer_out','transfer_in',
      'return_restock','return_defective','rma_out','rma_in','loan_out','loan_in','retire'
    ))
  `);
  await knex.raw(`CREATE INDEX idx_stock_movements_service ON stock_movements (tenant, service_id, created_at)`);
  await knex.raw(`CREATE INDEX idx_stock_movements_unit ON stock_movements (tenant, unit_id)`);
  await knex.raw(`CREATE INDEX idx_stock_movements_source ON stock_movements (tenant, source_doc_type, source_doc_id)`);

  // --- kit_components (single-level BOM) ---
  await knex.schema.createTable('kit_components', (table) => {
    table.uuid('tenant').notNullable();
    table.uuid('kit_service_id').notNullable();
    table.uuid('component_service_id').notNullable();
    table.integer('quantity').notNullable().defaultTo(1);
    table.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
    table.timestamp('updated_at', { useTz: true }).defaultTo(knex.fn.now());

    table.primary(['tenant', 'kit_service_id', 'component_service_id']);
    table.foreign('tenant').references('tenants.tenant');
    table.foreign(['tenant', 'kit_service_id']).references(['tenant', 'service_id']).inTable('service_catalog').onDelete('CASCADE');
    table.foreign(['tenant', 'component_service_id']).references(['tenant', 'service_id']).inTable('service_catalog').onDelete('RESTRICT');
  });
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('kit_components');
  await knex.raw('DROP INDEX IF EXISTS idx_stock_movements_source');
  await knex.raw('DROP INDEX IF EXISTS idx_stock_movements_unit');
  await knex.raw('DROP INDEX IF EXISTS idx_stock_movements_service');
  await knex.schema.dropTableIfExists('stock_movements');
  await knex.raw('DROP INDEX IF EXISTS idx_stock_units_client');
  await knex.raw('DROP INDEX IF EXISTS idx_stock_units_asset');
  await knex.raw('DROP INDEX IF EXISTS idx_stock_units_serial');
  await knex.raw('DROP INDEX IF EXISTS idx_stock_units_status');
  await knex.raw('DROP INDEX IF EXISTS idx_stock_units_tenant_mac');
  await knex.schema.dropTableIfExists('stock_units');
  await knex.schema.dropTableIfExists('stock_levels');
  await knex.schema.dropTableIfExists('product_inventory_settings');
};
