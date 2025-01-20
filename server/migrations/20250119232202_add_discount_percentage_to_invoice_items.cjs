/**
 * Add discount_percentage field to invoice_items table
 * This separates the storage of percentage values from monetary values in unit_price
 */
exports.up = async function(knex) {
  await knex.schema.alterTable('invoice_items', table => {
    // Add discount_percentage column as numeric to properly store percentage values
    // Nullable since it's only used for percentage-type discounts
    table.decimal('discount_percentage', 10, 4).nullable();
  });
};

exports.down = async function(knex) {
  await knex.schema.alterTable('invoice_items', table => {
    table.dropColumn('discount_percentage');
  });
};
