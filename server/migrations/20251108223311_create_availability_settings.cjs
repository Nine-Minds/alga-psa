/**
 * Create availability_settings table for managing appointment availability rules
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function(knex) {
  await knex.schema.createTable('availability_settings', function(table) {
    // Primary key columns
    table.uuid('availability_setting_id').defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('tenant').notNullable();

    // Setting type and scope
    table.text('setting_type').notNullable(); // user_hours, service_rules, general_settings
    table.uuid('user_id').nullable(); // For user-specific settings
    table.uuid('service_id').nullable(); // For service-specific rules

    // Time-based settings
    table.integer('day_of_week').nullable(); // 0-6 (Sunday-Saturday)
    table.time('start_time').nullable();
    table.time('end_time').nullable();
    table.boolean('is_available').notNullable().defaultTo(true);

    // Buffer and capacity settings
    table.integer('buffer_before_minutes').nullable();
    table.integer('buffer_after_minutes').nullable();
    table.integer('max_appointments_per_day').nullable();

    // Booking rules
    table.boolean('allow_without_contract').nullable();
    table.integer('advance_booking_days').nullable(); // How far ahead clients can book
    table.integer('minimum_notice_hours').nullable(); // Minimum time before appointment

    // Additional configuration as JSONB
    table.jsonb('config_json').nullable();

    // Timestamps
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());

    // Primary key
    table.primary(['tenant', 'availability_setting_id']);

    // Check constraint for setting_type
    table.check('??', ['setting_type'], 'IN', ['user_hours', 'service_rules', 'general_settings']);

    // Check constraint for day_of_week range
    table.check('??', ['day_of_week'], '>=', 0);
    table.check('??', ['day_of_week'], '<=', 6);
  });

  // Create indexes for common query patterns
  await knex.schema.raw(`
    CREATE INDEX idx_availability_settings_tenant
    ON availability_settings (tenant)
  `);

  await knex.schema.raw(`
    CREATE INDEX idx_availability_settings_tenant_type
    ON availability_settings (tenant, setting_type)
  `);

  await knex.schema.raw(`
    CREATE INDEX idx_availability_settings_tenant_user
    ON availability_settings (tenant, user_id)
  `);

  await knex.schema.raw(`
    CREATE INDEX idx_availability_settings_tenant_service
    ON availability_settings (tenant, service_id)
  `);

  await knex.schema.raw(`
    CREATE INDEX idx_availability_settings_tenant_user_day
    ON availability_settings (tenant, user_id, day_of_week)
  `);

  // Check if Citus is enabled
  const citusFn = await knex.raw(`
    SELECT EXISTS (
      SELECT 1 FROM pg_proc
      WHERE proname = 'create_distributed_table'
    ) AS exists;
  `);

  if (citusFn.rows?.[0]?.exists) {
    await knex.raw("SELECT create_distributed_table('availability_settings', 'tenant')");
  } else {
    console.warn('[create_availability_settings] Skipping create_distributed_table (function unavailable)');
  }

  console.log('✅ Created availability_settings table');
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function(knex) {
  await knex.schema.dropTableIfExists('availability_settings');
  console.log('✅ Dropped availability_settings table');
};

// Disable transaction for Citus DB compatibility
// create_distributed_table cannot run inside a transaction block
exports.config = { transaction: false };
