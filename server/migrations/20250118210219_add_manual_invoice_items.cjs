/**
 * Add manual line items support to invoice_items
 */
exports.up = function(knex) {
  return knex.schema.alterTable('invoice_items', function(table) {
    // Add is_manual flag
    table.boolean('is_manual').notNullable().defaultTo(false);
    
    // Add audit fields
    table.string('created_by');
    table.string('updated_by');
    table.timestamp('created_at').defaultTo(knex.fn.now());
    table.timestamp('updated_at');

    // Add index for faster queries on is_manual
    table.index(['invoice_id', 'is_manual']);
  });
};

exports.down = function(knex) {
  return knex.schema.alterTable('invoice_items', function(table) {
    // Remove index first
    table.dropIndex(['invoice_id', 'is_manual']);
    
    // Remove columns
    table.dropColumn('is_manual');
    table.dropColumn('created_by');
    table.dropColumn('updated_by');
    table.dropColumn('created_at');
    table.dropColumn('updated_at');
  });
};
