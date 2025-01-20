/**
 * Add discount support to invoice items
 */
exports.up = async function(knex) {
  await knex.schema.alterTable('invoice_items', table => {
    // Add discount-specific columns
    table.boolean('is_discount').defaultTo(false);
    table.enum('discount_type', ['percentage', 'fixed']).nullable();
    table.uuid('applies_to_item_id')
      .nullable();
    
    // Add foreign key that references both tenant and item_id
    table.foreign(['tenant', 'applies_to_item_id'])
      .references(['tenant', 'item_id'])
      .inTable('invoice_items')
      .onDelete('SET NULL');

    // Add index for better query performance on common filters
    table.index(['is_discount', 'invoice_id', 'tenant']);
  });
};

exports.down = async function(knex) {
  await knex.schema.alterTable('invoice_items', table => {
    table.dropIndex(['is_discount', 'invoice_id', 'tenant']);
    // Drop the foreign key constraint before dropping the column
    table.dropForeign(['tenant', 'applies_to_item_id']);
    table.dropColumn('applies_to_item_id');
    table.dropColumn('discount_type');
    table.dropColumn('is_discount');
  });
};
