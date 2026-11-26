/**
 * Adds quote_items.tax_unresolved so quote recalculation can record that a
 * taxable line's region had no active tax rate (its tax is stored as 0 and the
 * line must not be mistaken for a genuinely untaxed one).
 *
 * Additive and Citus-safe: one boolean column with a constant default, so no
 * table rewrite and no non-immutable default expression. Idempotent: guarded by
 * hasColumn, so a re-run (or a database that already has the column) is a no-op.
 *
 * @param {import('knex').Knex} knex
 */
exports.up = async function up(knex) {
  if (await knex.schema.hasColumn('quote_items', 'tax_unresolved')) return;
  await knex.schema.alterTable('quote_items', (table) => {
    table.boolean('tax_unresolved').notNullable().defaultTo(false);
  });
};

/**
 * @param {import('knex').Knex} knex
 */
exports.down = async function down(knex) {
  if (!(await knex.schema.hasColumn('quote_items', 'tax_unresolved'))) return;
  await knex.schema.alterTable('quote_items', (table) => {
    table.dropColumn('tax_unresolved');
  });
};
