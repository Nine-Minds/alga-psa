/**
 * Migration to change the quantity field from bigInteger to decimal
 * This allows for fractional quantities to be stored correctly instead of being truncated to integers
 */
exports.up = function(knex) {
  return knex.schema
    // Fix invoice_items table
    .alterTable('invoice_items', function(table) {
      // Modify the quantity column from bigInteger to decimal(10,2)
      // This allows for up to 10 digits total with 2 decimal places
      table.decimal('quantity', 10, 2).notNullable().alter();
    })
    // Fix usage_tracking table
    .alterTable('usage_tracking', function(table) {
      // Modify the quantity column from bigInteger to decimal(10,2)
      table.decimal('quantity', 10, 2).notNullable().alter();
    });
};

exports.down = function(knex) {
  return knex.schema
    // Revert invoice_items table changes
    .alterTable('invoice_items', function(table) {
      // Revert back to bigInteger
      table.bigInteger('quantity').notNullable().alter();
    })
    // Revert usage_tracking table changes
    .alterTable('usage_tracking', function(table) {
      // Revert back to bigInteger
      table.bigInteger('quantity').notNullable().alter();
    });
};
