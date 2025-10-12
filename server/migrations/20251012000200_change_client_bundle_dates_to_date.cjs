/**
 * Normalize client_plan_bundles start/end to DATE (timezone-agnostic).
 * Previously these were timestamptz and could shift across timezones.
 */

/** @param {import('knex').Knex} knex */
exports.up = async function up(knex) {
  const exists = await knex.schema.hasTable('client_plan_bundles');
  if (!exists) return;

  // Convert timestamptz -> date without losing intended day semantics
  await knex.raw(`
    ALTER TABLE client_plan_bundles
    ALTER COLUMN start_date TYPE date USING start_date::date,
    ALTER COLUMN end_date TYPE date USING end_date::date;
  `);
};

/** @param {import('knex').Knex} knex */
exports.down = async function down(knex) {
  const exists = await knex.schema.hasTable('client_plan_bundles');
  if (!exists) return;

  // Revert back to timestamp with time zone at midnight UTC
  await knex.raw(`
    ALTER TABLE client_plan_bundles
    ALTER COLUMN start_date TYPE timestamptz USING (start_date::timestamp AT TIME ZONE 'UTC'),
    ALTER COLUMN end_date TYPE timestamptz USING (end_date::timestamp AT TIME ZONE 'UTC');
  `);
};

