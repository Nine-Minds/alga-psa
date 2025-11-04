/**
 * Create calendar_providers table for managing calendar integrations
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function(knex) {
  return knex.schema.createTable('calendar_providers', function(table) {
    // Primary key - UUID with tenant for CitusDB
    table.uuid('id').notNullable();
    table.uuid('tenant').notNullable();
    
    // Provider configuration
    table.string('provider_type', 50).notNullable(); // 'google', 'microsoft'
    table.string('provider_name', 255).notNullable(); // User-friendly name
    table.string('calendar_id', 255).notNullable(); // External calendar ID
    table.boolean('is_active').defaultTo(true);
    
    // Sync configuration
    table.enum('sync_direction', ['bidirectional', 'to_external', 'from_external']).defaultTo('bidirectional');
    
    // Status tracking
    table.enum('status', ['connected', 'disconnected', 'error', 'configuring']).defaultTo('configuring');
    table.timestamp('last_sync_at').nullable();
    table.text('error_message').nullable();
    
    // Vendor-specific configuration (JSON)
    table.jsonb('vendor_config').notNullable().defaultTo('{}');
    
    // Timestamps
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
    
    // Primary key with tenant for CitusDB compatibility
    table.primary(['id', 'tenant']);
    
    // Foreign key to tenants table
    table.foreign('tenant').references('tenant').inTable('tenants');
    
    // Indexes
    table.index(['tenant', 'is_active']);
    table.index(['tenant', 'provider_type']);
    table.index(['tenant', 'calendar_id']);
    
    // Unique constraint to prevent duplicate calendars per tenant
    table.unique(['tenant', 'calendar_id', 'provider_type']);
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function(knex) {
  return knex.schema.dropTableIfExists('calendar_providers');
};

