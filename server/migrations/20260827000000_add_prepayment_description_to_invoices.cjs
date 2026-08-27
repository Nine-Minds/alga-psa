/** @param { import("knex").Knex } knex */
exports.up = async function(knex) {
  await knex.schema.alterTable('invoices', (table) => {
    table.text('prepayment_description').nullable();
  });
};

/** @param { import("knex").Knex } knex */
exports.down = async function(knex) {
  await knex.schema.alterTable('invoices', (table) => {
    table.dropColumn('prepayment_description');
  });
};
