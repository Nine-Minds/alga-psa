/** @param {import('knex').Knex} knex */
exports.up = async function up(knex) {
  await knex.schema.alterTable('quote_items', (table) => {
    table.bigInteger('cost').nullable().defaultTo(null);
    table.string('cost_currency', 3).nullable().defaultTo(null);
  });
};

/** @param {import('knex').Knex} knex */
exports.down = async function down(knex) {
  await knex.schema.alterTable('quote_items', (table) => {
    table.dropColumn('cost_currency');
    table.dropColumn('cost');
  });
};
