/**
 * Make project-billing schedule policy explicit and keep lifecycle enforcement
 * identical on PostgreSQL and Citus.
 *
 * Citus does not propagate ordinary coordinator triggers to distributed table
 * placements. Supported writes already use optimistic source-status updates,
 * so the application model is the lifecycle boundary and the database retains
 * only the status-value CHECK constraint.
 *
 * @param {import('knex').Knex} knex
 */
exports.up = async function up(knex) {
  if (!await knex.schema.hasColumn('project_billing_schedule_entries', 'requires_payment_before_work')) {
    await knex.schema.alterTable('project_billing_schedule_entries', (table) => {
      table.boolean('requires_payment_before_work').notNullable().defaultTo(false);
    });
  }

  await knex.raw(`
    DROP TRIGGER IF EXISTS project_billing_schedule_status_transition_guard
    ON project_billing_schedule_entries
  `);
  await knex.raw('DROP FUNCTION IF EXISTS guard_project_billing_schedule_status_transition()');

  // Product policy: every configured T&M cap is a hard cap. Thresholds remain
  // notification points, but notify-only billing is no longer supported.
  await knex('project_billing_configs')
    .whereNotNull('cap_amount')
    .update({ cap_behavior: 'hard_cap' });
};

/**
 * The hard-cap normalization is intentionally not reversed: it is a money
 * safety policy and rolling back code must not silently restore uncapped bills.
 *
 * @param {import('knex').Knex} knex
 */
exports.down = async function down(knex) {
  if (await knex.schema.hasColumn('project_billing_schedule_entries', 'requires_payment_before_work')) {
    await knex.schema.alterTable('project_billing_schedule_entries', (table) => {
      table.dropColumn('requires_payment_before_work');
    });
  }
};
