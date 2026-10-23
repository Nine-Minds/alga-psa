/**
 * Records the operator's merge billing choice (FR-G2).
 *
 * `source_profile` (the default, and the behaviour every merge before this had)
 * stamps moving rows with no profile of their own with the moved default, so
 * the merged site keeps billing separately. `target_default` leaves them null
 * so they inherit the target's default.
 */

exports.up = async function up(knex) {
  if (await knex.schema.hasColumn('client_merges', 'billing_strategy')) return;
  await knex.schema.alterTable('client_merges', (table) => {
    table.text('billing_strategy').notNullable().defaultTo('source_profile');
  });
  await knex.raw(`
    ALTER TABLE client_merges
    ADD CONSTRAINT client_merges_billing_strategy_check
    CHECK (billing_strategy IN ('source_profile', 'target_default'))
  `);
};

exports.down = async function down(knex) {
  if (!(await knex.schema.hasColumn('client_merges', 'billing_strategy'))) return;
  await knex.raw('ALTER TABLE client_merges DROP CONSTRAINT IF EXISTS client_merges_billing_strategy_check');
  await knex.schema.alterTable('client_merges', (table) => {
    table.dropColumn('billing_strategy');
  });
};
