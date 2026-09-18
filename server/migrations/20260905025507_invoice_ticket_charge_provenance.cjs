// Immutable origin of newly generated charges. Historical provenance stays unknown.
exports.up = async function(knex) {
  await knex.schema.alterTable('invoice_charges', (table) => {
    table.text('billing_charge_type').nullable();
  });
};
exports.down = async function(knex) {
  await knex.schema.alterTable('invoice_charges', (table) => {
    table.dropColumn('billing_charge_type');
  });
};
