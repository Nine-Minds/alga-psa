/**
 * This migration makes the service_id column nullable in the invoice_items table.
 * This change allows for invoice items that are not directly associated with a service,
 * such as discounts or custom charges.
 */

exports.up = function(knex) {
  return knex.schema.alterTable('invoice_items', function(table) {
    table.uuid('service_id').nullable().alter();
  });
};

exports.down = function(knex) {
  return knex.schema.alterTable('invoice_items', function(table) {
    table.uuid('service_id').notNullable().alter();
  });
};