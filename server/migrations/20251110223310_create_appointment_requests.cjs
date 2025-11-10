/**
 * Create appointment_requests table for managing client appointment requests
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function(knex) {
  await knex.schema.createTable('appointment_requests', function(table) {
    // Primary key columns
    table.uuid('appointment_request_id').defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('tenant').notNullable();

    // Related entities
    table.uuid('client_id').nullable(); // Nullable for unauthenticated requests
    table.uuid('contact_id').nullable();
    table.uuid('service_id').notNullable();

    // Requested appointment details
    table.date('requested_date').notNullable();
    table.time('requested_time').notNullable();
    table.integer('requested_duration').notNullable(); // Duration in minutes
    table.uuid('preferred_assigned_user_id').nullable();

    // Status and description
    table.text('status').notNullable().defaultTo('pending');
    table.text('description').nullable();
    table.uuid('ticket_id').nullable(); // Link to existing ticket if applicable

    // Authentication and requester info (for unauthenticated requests)
    table.boolean('is_authenticated').notNullable().defaultTo(true);
    table.text('requester_name').nullable();
    table.text('requester_email').nullable();
    table.text('requester_phone').nullable();
    table.text('company_name').nullable();

    // Approval workflow fields
    table.uuid('schedule_entry_id').nullable(); // Set when approved
    table.uuid('approved_by_user_id').nullable();
    table.timestamp('approved_at').nullable();
    table.text('declined_reason').nullable();

    // Timestamps
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());

    // Primary key
    table.primary(['tenant', 'appointment_request_id']);
  });

  // Add check constraint for status
  await knex.schema.raw(`
    ALTER TABLE appointment_requests
    ADD CONSTRAINT appointment_requests_status_check
    CHECK (status IN ('pending', 'approved', 'declined', 'cancelled'))
  `);

  // Create indexes for common query patterns
  await knex.schema.raw(`
    CREATE INDEX idx_appointment_requests_tenant
    ON appointment_requests (tenant)
  `);

  await knex.schema.raw(`
    CREATE INDEX idx_appointment_requests_tenant_status
    ON appointment_requests (tenant, status)
  `);

  await knex.schema.raw(`
    CREATE INDEX idx_appointment_requests_tenant_client
    ON appointment_requests (tenant, client_id)
  `);

  await knex.schema.raw(`
    CREATE INDEX idx_appointment_requests_tenant_service
    ON appointment_requests (tenant, service_id)
  `);

  await knex.schema.raw(`
    CREATE INDEX idx_appointment_requests_tenant_date
    ON appointment_requests (tenant, requested_date)
  `);

  await knex.schema.raw(`
    CREATE INDEX idx_appointment_requests_tenant_schedule_entry
    ON appointment_requests (tenant, schedule_entry_id)
  `);

  // Check if Citus is enabled
  const citusFn = await knex.raw(`
    SELECT EXISTS (
      SELECT 1 FROM pg_proc
      WHERE proname = 'create_distributed_table'
    ) AS exists;
  `);

  if (citusFn.rows?.[0]?.exists) {
    await knex.raw("SELECT create_distributed_table('appointment_requests', 'tenant')");
  } else {
    console.warn('[create_appointment_requests] Skipping create_distributed_table (function unavailable)');
  }

  console.log('✅ Created appointment_requests table');
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function(knex) {
  await knex.schema.dropTableIfExists('appointment_requests');
  console.log('✅ Dropped appointment_requests table');
};

// Disable transaction for Citus DB compatibility
// create_distributed_table cannot run inside a transaction block
exports.config = { transaction: false };
