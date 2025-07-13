/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function(knex) {
  return knex.schema.createTable('inbound_ticket_defaults', function(table) {
    // Primary key - UUID with tenant for CitusDB
    table.uuid('id').notNullable();
    table.uuid('tenant').notNullable();
    
    // Default configuration identification
    table.string('short_name', 100).notNullable(); // e.g., "email-general", "support-domain"
    table.string('display_name', 255).notNullable(); // e.g., "General Email Support"
    table.text('description').nullable(); // Optional description
    
    // The actual default values (JSON)
    table.jsonb('defaults').notNullable().defaultTo('{}');
    
    // Status
    table.boolean('is_active').defaultTo(true);
    
    // Timestamps
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
    
    // Primary key with tenant for CitusDB compatibility
    table.primary(['id', 'tenant']);
    
    // Foreign key to tenants table
    table.foreign('tenant').references('tenant').inTable('tenants');
    
    // Indexes
    table.index(['tenant', 'is_active']);
    table.index(['tenant', 'short_name']);
    
    // Unique constraint to prevent duplicate short names per tenant
    table.unique(['tenant', 'short_name']);
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function(knex) {
  return knex.schema.dropTableIfExists('inbound_ticket_defaults');
};