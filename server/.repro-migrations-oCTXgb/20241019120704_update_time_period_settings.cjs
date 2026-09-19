/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function(knex) {
  // Create the 'time_period_settings' table
  return knex.schema.createTable('time_period_settings', function(table) {
    // Primary key, default UUID value
    table.uuid('time_period_settings_id').primary().defaultTo(knex.raw('gen_random_uuid()'));

    // Tenant ID, foreign key to 'tenants' table
    table.uuid('tenant_id').notNullable();
    table.foreign('tenant_id').references('tenants.tenant');

    // Start day and frequency settings
    table.integer('start_day').notNullable();
    table.integer('frequency').notNullable();

    // Frequency unit as an enum
    table.enum('frequency_unit', ['day', 'week', 'month', 'year'], {
      useNative: true,
      enumName: 'frequency_unit_enum',
    }).notNullable();

    // Active status and effective dates
    table.boolean('is_active').notNullable().defaultTo(true);
    table.date('effective_from').notNullable();
    table.date('effective_to').nullable();

    // Timestamps
    table.timestamp('created_at').defaultTo(knex.fn.now());
    table.timestamp('updated_at').defaultTo(knex.fn.now());

    // Indexes for performance (optional)
    table.index(['tenant_id']);
    table.index(['is_active']);
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function(knex) {
  // Drop the table and the enum type if it exists
  await knex.schema.dropTableIfExists('time_period_settings');
  await knex.raw('DROP TYPE IF EXISTS frequency_unit_enum;');
};