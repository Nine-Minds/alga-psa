/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function(knex) {
  return knex.schema.alterTable('email_providers', function(table) {
    // Add reference to inbound ticket defaults
    table.uuid('inbound_ticket_defaults_id').nullable();
    
    // Add index for performance
    table.index(['tenant', 'inbound_ticket_defaults_id']);
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function(knex) {
  return knex.schema.alterTable('email_providers', function(table) {
    table.dropIndex(['tenant', 'inbound_ticket_defaults_id']);
    table.dropColumn('inbound_ticket_defaults_id');
  });
};