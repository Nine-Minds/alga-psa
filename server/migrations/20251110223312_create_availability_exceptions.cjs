/**
 * Create availability_exceptions table for managing time-off and special availability dates
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function(knex) {
  await knex.schema.createTable('availability_exceptions', function(table) {
    // Primary key columns
    table.uuid('exception_id').defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('tenant').notNullable();

    // Exception details
    table.uuid('user_id').nullable(); // Nullable for company-wide exceptions
    table.date('date').notNullable();
    table.boolean('is_available').notNullable();
    table.text('reason').nullable();

    // Timestamps
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());

    // Primary key
    table.primary(['tenant', 'exception_id']);
  });

  // Create indexes for common query patterns
  await knex.schema.raw(`
    CREATE INDEX idx_availability_exceptions_tenant
    ON availability_exceptions (tenant)
  `);

  await knex.schema.raw(`
    CREATE INDEX idx_availability_exceptions_tenant_user
    ON availability_exceptions (tenant, user_id)
  `);

  await knex.schema.raw(`
    CREATE INDEX idx_availability_exceptions_tenant_date
    ON availability_exceptions (tenant, date)
  `);

  await knex.schema.raw(`
    CREATE INDEX idx_availability_exceptions_tenant_user_date
    ON availability_exceptions (tenant, user_id, date)
  `);

  // Check if Citus is enabled
  const citusFn = await knex.raw(`
    SELECT EXISTS (
      SELECT 1 FROM pg_proc
      WHERE proname = 'create_distributed_table'
    ) AS exists;
  `);

  if (citusFn.rows?.[0]?.exists) {
    await knex.raw("SELECT create_distributed_table('availability_exceptions', 'tenant')");
  } else {
    console.warn('[create_availability_exceptions] Skipping create_distributed_table (function unavailable)');
  }

  console.log('✅ Created availability_exceptions table');
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function(knex) {
  await knex.schema.dropTableIfExists('availability_exceptions');
  console.log('✅ Dropped availability_exceptions table');
};

// Disable transaction for Citus DB compatibility
// create_distributed_table cannot run inside a transaction block
exports.config = { transaction: false };
