/**
 * Add per-quote optional section headings for the grouped quote layout.
 *
 * `quotes` is not Citus-distributed (see the quote terms migration), so normal
 * nullable column DDL is correct here. Each ALTER adds only one column to keep
 * this safe if the table's distribution status changes in the future.
 *
 * @param {import('knex').Knex} knex
 * @returns {Promise<void>}
 */

exports.up = async function up(knex) {
  for (const column of ['recurring_section_title', 'onetime_section_title']) {
    if (!(await knex.schema.hasColumn('quotes', column))) {
      await knex.schema.alterTable('quotes', (table) => {
        table.text(column).nullable();
      });
    }
  }
};

exports.down = async function down(knex) {
  const columns = ['recurring_section_title', 'onetime_section_title'];
  for (const column of columns) {
    if (await knex.schema.hasColumn('quotes', column)) {
      await knex.schema.alterTable('quotes', (table) => table.dropColumn(column));
    }
  }
};
