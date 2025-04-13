/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function(knex) {
  // 1. tax_amount column already exists on invoice_items (verified via schema check)

  // 2. Create invoice_item_details table
  await knex.schema.createTable('invoice_item_details', (table) => {
    table.uuid('item_detail_id').notNullable().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('item_id').notNullable(); // FK defined below
    table.uuid('service_id').notNullable(); // FK defined below
    table.uuid('config_id').notNullable(); // FK defined below
    table.integer('quantity').notNullable();
    table.integer('rate').notNullable().comment('Allocated rate for this specific detail in cents');
    table.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
    table.timestamp('updated_at', { useTz: true }).defaultTo(knex.fn.now());
    table.uuid('tenant').notNullable(); // Changed from text to uuid

    table.index('item_id');
    table.index('service_id');
    table.index('config_id');
    table.index('tenant');

    // Composite primary key
    table.primary(['tenant', 'item_detail_id']);

    // Composite foreign keys (assuming target tables also use tenant in PK)
    table.foreign(['tenant', 'item_id']).references(['tenant', 'item_id']).inTable('invoice_items').onDelete('CASCADE');
    table.foreign(['tenant', 'service_id']).references(['tenant', 'service_id']).inTable('service_catalog').onDelete('SET NULL');
    table.foreign(['tenant', 'config_id']).references(['tenant', 'config_id']).inTable('plan_service_configuration').onDelete('SET NULL');
  });

  // 3. Create invoice_item_fixed_details table
  await knex.schema.createTable('invoice_item_fixed_details', (table) => {
    table.uuid('item_detail_id').notNullable(); // Part of composite PK/FK
    table.uuid('tenant').notNullable(); // Added tenant column
    table.decimal('base_rate', 16, 2).comment('The plan\'s base rate at the time');
    table.boolean('enable_proration').comment('Proration setting at the time');
    table.integer('fmv').comment('Calculated Fair Market Value for allocation in cents');
    table.decimal('proportion').comment('Calculated proportion for allocation');
    table.integer('allocated_amount').comment('Calculated allocated amount for this detail in cents');
    table.integer('tax_amount').comment('Tax calculated for this specific allocation in cents');
    table.decimal('tax_rate').comment('Tax rate applied to this specific allocation');

    // No separate created_at/updated_at needed, linked to parent detail
    // Composite primary key
    table.primary(['tenant', 'item_detail_id']);

    // Composite foreign key
    table.foreign(['tenant', 'item_detail_id']).references(['tenant', 'item_detail_id']).inTable('invoice_item_details').onDelete('CASCADE');
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function(knex) {
  // Drop in reverse order of creation due to dependencies
  await knex.schema.dropTableIfExists('invoice_item_fixed_details');
  await knex.schema.dropTableIfExists('invoice_item_details');

  // Remove tax_amount from invoice_items - Skipped as it pre-existed this migration
};
