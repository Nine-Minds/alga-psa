/**
 * Create calendar_event_mappings table for tracking sync relationships
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function(knex) {
  return knex.schema.createTable('calendar_event_mappings', function(table) {
    // Primary key - UUID with tenant for CitusDB
    table.uuid('id').notNullable();
    table.uuid('tenant').notNullable();
    
    // Foreign key references
    table.uuid('calendar_provider_id').notNullable();
    table.uuid('schedule_entry_id').notNullable();
    
    // External calendar event ID
    table.string('external_event_id', 255).notNullable();
    
    // Sync status tracking
    table.enum('sync_status', ['synced', 'pending', 'conflict', 'error']).defaultTo('pending');
    table.timestamp('last_synced_at').nullable();
    table.text('sync_error_message').nullable();
    
    // Sync direction for this mapping
    table.enum('sync_direction', ['to_external', 'from_external']).nullable();
    
    // Last modified timestamps for conflict resolution
    table.timestamp('alga_last_modified').nullable();
    table.timestamp('external_last_modified').nullable();
    
    // Timestamps
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
    
    // Primary key with tenant for CitusDB compatibility
    table.primary(['id', 'tenant']);
    
    // Foreign key to tenants table
    table.foreign('tenant').references('tenant').inTable('tenants');
    
    // Indexes
    table.index(['tenant', 'calendar_provider_id']);
    table.index(['tenant', 'schedule_entry_id']);
    table.index(['tenant', 'external_event_id']);
    table.index(['tenant', 'sync_status']);
    
    // Unique constraint to prevent duplicate mappings
    // Each schedule entry can only map to one external event per provider
    table.unique(['tenant', 'schedule_entry_id', 'calendar_provider_id']);
    
    // Unique constraint for external event ID per provider
    table.unique(['tenant', 'external_event_id', 'calendar_provider_id']);
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function(knex) {
  return knex.schema.dropTableIfExists('calendar_event_mappings');
};

