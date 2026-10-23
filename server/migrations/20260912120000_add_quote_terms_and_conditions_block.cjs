/**
 * Rich text Terms & Conditions on quotes.
 *
 *   terms_and_conditions        — kept as the plain-text projection. Load-bearing
 *                                 for the REST API, workflow business operations
 *                                 and the `termsAndConditions` template binding,
 *                                 all of which expect a string.
 *
 *   terms_and_conditions_block  — nullable JSONB holding the authored BlockNote
 *                                 block array. When populated it wins for display;
 *                                 when NULL the text column renders exactly as it
 *                                 does today.
 *
 * A plain ALTER TABLE is correct: `quotes` is not a Citus-distributed table. No
 * migration calls create_distributed_table on it, and
 * 20260702140000_add_sales_order_quote_link.cjs:18-27 skips an FK to `quotes`
 * precisely because it is not distributed. The hasColumn guard and the one
 * subcommand per alterTable call follow house style and keep the migration safe
 * if that ever changes.
 *
 * @param {import('knex').Knex} knex
 * @returns {Promise<void>}
 */
exports.up = async function up(knex) {
  const hasBlockColumn = await knex.schema.hasColumn('quotes', 'terms_and_conditions_block');

  if (!hasBlockColumn) {
    // One subcommand per ALTER: Citus rejects an ALTER carrying two utility
    // subcommands with "cannot execute multiple utility events".
    await knex.schema.alterTable('quotes', (table) => {
      table.jsonb('terms_and_conditions_block').nullable();
    });
  }
};

/**
 * @param {import('knex').Knex} knex
 * @returns {Promise<void>}
 */
exports.down = async function down(knex) {
  const hasBlockColumn = await knex.schema.hasColumn('quotes', 'terms_and_conditions_block');

  if (hasBlockColumn) {
    await knex.schema.alterTable('quotes', (table) => {
      table.dropColumn('terms_and_conditions_block');
    });
  }
};
