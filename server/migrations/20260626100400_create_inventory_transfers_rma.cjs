/**
 * Inventory module — in-transit transfers + RMA cases (standard + advance-replacement).
 */

exports.up = async function up(knex) {
  await knex.schema.createTable('stock_transfers', (table) => {
    table.uuid('tenant').notNullable();
    table.uuid('transfer_id').defaultTo(knex.raw('gen_random_uuid()')).notNullable();
    table.uuid('from_location_id').notNullable();
    table.uuid('to_location_id').notNullable();
    table.text('status').notNullable().defaultTo('dispatched');
    table.uuid('dispatched_by').nullable();
    table.timestamp('dispatched_at', { useTz: true }).nullable();
    table.uuid('received_by').nullable();
    table.timestamp('received_at', { useTz: true }).nullable();
    table.text('notes').nullable();
    table.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
    table.timestamp('updated_at', { useTz: true }).defaultTo(knex.fn.now());

    table.primary(['tenant', 'transfer_id']);
    table.foreign('tenant').references('tenants.tenant');
    table.foreign(['tenant', 'from_location_id']).references(['tenant', 'location_id']).inTable('stock_locations').onDelete('RESTRICT');
    table.foreign(['tenant', 'to_location_id']).references(['tenant', 'location_id']).inTable('stock_locations').onDelete('RESTRICT');
    table.foreign(['tenant', 'dispatched_by']).references(['tenant', 'user_id']).inTable('users');
    table.foreign(['tenant', 'received_by']).references(['tenant', 'user_id']).inTable('users');
  });

  await knex.raw(`
    ALTER TABLE stock_transfers
    ADD CONSTRAINT stock_transfers_status_check
    CHECK (status IN ('dispatched','received','cancelled'))
  `);

  await knex.schema.createTable('stock_transfer_lines', (table) => {
    table.uuid('tenant').notNullable();
    table.uuid('transfer_line_id').defaultTo(knex.raw('gen_random_uuid()')).notNullable();
    table.uuid('transfer_id').notNullable();
    table.uuid('service_id').notNullable();
    table.integer('quantity').notNullable();
    table.uuid('unit_id').nullable();
    table.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());

    table.primary(['tenant', 'transfer_line_id']);
    table.foreign('tenant').references('tenants.tenant');
    table.foreign(['tenant', 'transfer_id']).references(['tenant', 'transfer_id']).inTable('stock_transfers').onDelete('CASCADE');
    table.foreign(['tenant', 'service_id']).references(['tenant', 'service_id']).inTable('service_catalog').onDelete('RESTRICT');
    table.foreign(['tenant', 'unit_id']).references(['tenant', 'unit_id']).inTable('stock_units');
  });

  await knex.raw(`CREATE INDEX idx_transfer_lines_transfer ON stock_transfer_lines (tenant, transfer_id)`);

  await knex.schema.createTable('rma_cases', (table) => {
    table.uuid('tenant').notNullable();
    table.uuid('rma_id').defaultTo(knex.raw('gen_random_uuid()')).notNullable();
    table.text('rma_type').notNullable().defaultTo('standard');
    table.uuid('returned_unit_id').nullable();
    table.uuid('service_id').nullable();
    table.uuid('client_id').nullable();
    table.uuid('asset_id').nullable();
    table.uuid('vendor_id').nullable();
    table.text('rma_reference').nullable();
    table.text('reason').nullable();
    table.text('status').notNullable().defaultTo('open');
    table.uuid('replacement_unit_id').nullable();
    table.timestamp('dead_unit_due_date', { useTz: true }).nullable();
    table.timestamp('dead_unit_returned_at', { useTz: true }).nullable();
    table.timestamp('opened_at', { useTz: true }).defaultTo(knex.fn.now());
    table.timestamp('closed_at', { useTz: true }).nullable();
    table.uuid('created_by').nullable();
    table.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
    table.timestamp('updated_at', { useTz: true }).defaultTo(knex.fn.now());

    table.primary(['tenant', 'rma_id']);
    table.foreign('tenant').references('tenants.tenant');
    table.foreign(['tenant', 'returned_unit_id']).references(['tenant', 'unit_id']).inTable('stock_units');
    table.foreign(['tenant', 'replacement_unit_id']).references(['tenant', 'unit_id']).inTable('stock_units');
    table.foreign(['tenant', 'service_id']).references(['tenant', 'service_id']).inTable('service_catalog');
    table.foreign(['tenant', 'client_id']).references(['tenant', 'client_id']).inTable('clients');
    table.foreign(['tenant', 'asset_id']).references(['tenant', 'asset_id']).inTable('assets');
    table.foreign(['tenant', 'vendor_id']).references(['tenant', 'vendor_id']).inTable('vendors');
    table.foreign(['tenant', 'created_by']).references(['tenant', 'user_id']).inTable('users');
  });

  await knex.raw(`
    ALTER TABLE rma_cases
    ADD CONSTRAINT rma_cases_type_check
    CHECK (rma_type IN ('standard','advance_replacement'))
  `);
  await knex.raw(`
    ALTER TABLE rma_cases
    ADD CONSTRAINT rma_cases_status_check
    CHECK (status IN (
      'open','awaiting_return','returned','sent_to_vendor','replacement_received',
      'replacement_deployed','dead_unit_owed','dead_unit_returned','replaced','credited','charged','closed'
    ))
  `);
  await knex.raw(`CREATE INDEX idx_rma_cases_status ON rma_cases (tenant, status)`);
  await knex.raw(`CREATE INDEX idx_rma_cases_due ON rma_cases (tenant, dead_unit_due_date)`);
};

exports.down = async function down(knex) {
  await knex.raw('DROP INDEX IF EXISTS idx_rma_cases_due');
  await knex.raw('DROP INDEX IF EXISTS idx_rma_cases_status');
  await knex.schema.dropTableIfExists('rma_cases');
  await knex.raw('DROP INDEX IF EXISTS idx_transfer_lines_transfer');
  await knex.schema.dropTableIfExists('stock_transfer_lines');
  await knex.schema.dropTableIfExists('stock_transfers');
};
