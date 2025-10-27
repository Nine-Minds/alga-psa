/**
 * Rename invoice_items tables to invoice_charges equivalents and provide a backward-compatible view.
 * @param {import('knex').Knex} knex
 */
exports.up = async function up(knex) {
  await knex.schema.renameTable('invoice_items', 'invoice_charges');
  await knex.schema.renameTable('invoice_item_details', 'invoice_charge_details');
  await knex.schema.renameTable('invoice_item_fixed_details', 'invoice_charge_fixed_details');

  // Maintain backward compatibility for raw queries that still reference invoice_items during rollout.
  await knex.raw(`
    CREATE OR REPLACE VIEW invoice_items AS
    SELECT * FROM invoice_charges;
  `);
};

/**
 * Revert invoice_charges back to invoice_items and remove the compatibility view.
 * @param {import('knex').Knex} knex
 */
exports.down = async function down(knex) {
  await knex.raw('DROP VIEW IF EXISTS invoice_items;');

  await knex.schema.renameTable('invoice_charge_fixed_details', 'invoice_item_fixed_details');
  await knex.schema.renameTable('invoice_charge_details', 'invoice_item_details');
  await knex.schema.renameTable('invoice_charges', 'invoice_items');
};
