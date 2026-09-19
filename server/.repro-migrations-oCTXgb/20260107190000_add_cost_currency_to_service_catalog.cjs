/**
 * Add cost_currency column to service_catalog table.
 * This allows storing the currency for the cost field separately from pricing currencies.
 */

exports.up = async function up(knex) {
  const hasColumn = await knex.schema.hasColumn('service_catalog', 'cost_currency');
  if (!hasColumn) {
    await knex.schema.alterTable('service_catalog', (table) => {
      table.string('cost_currency', 3).nullable().defaultTo('USD');
    });
    console.log('Added cost_currency column to service_catalog');
  }
};

exports.down = async function down(knex) {
  const hasColumn = await knex.schema.hasColumn('service_catalog', 'cost_currency');
  if (hasColumn) {
    await knex.schema.alterTable('service_catalog', (table) => {
      table.dropColumn('cost_currency');
    });
  }
};
