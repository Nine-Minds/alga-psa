
/**
 * Migration to remove the dsl column from the invoice_templates table
 * This is needed because we're moving away from the DSL approach to AssemblyScript
 */
exports.up = function(knex) {
  return knex.schema.alterTable('invoice_templates', table => {
    // Drop the dsl column completely
    table.dropColumn('dsl');
  });
};

exports.down = function(knex) {
  return knex.schema.alterTable('invoice_templates', table => {
    // Revert: Add back the dsl column with NOT NULL constraint
    table.text('dsl').notNullable();
  });
};
