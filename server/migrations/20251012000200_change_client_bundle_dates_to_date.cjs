/**
 * Normalize client_contracts start/end to DATE (timezone-agnostic).
 * Previously these were timestamptz and could shift across timezones.
 */

/** @param {import('knex').Knex} knex */
exports.up = async function up(knex) {
  // Check for new terminology first (post-rename migration)
  const hasClientContracts = await knex.schema.hasTable('client_contracts');
  if (!hasClientContracts) {
    // Fallback to legacy table name
    const exists = await knex.schema.hasTable('client_plan_bundles');
    if (!exists) return;
  }

  const tableName = hasClientContracts ? 'client_contracts' : 'client_plan_bundles';

  // Convert timestamptz -> date without losing intended day semantics
  await knex.raw(`
    ALTER TABLE ${tableName}
    ALTER COLUMN start_date TYPE date USING start_date::date,
    ALTER COLUMN end_date TYPE date USING end_date::date;
  `);
};

/** @param {import('knex').Knex} knex */
exports.down = async function down(knex) {
  // Check for new terminology first (post-rename migration)
  const hasClientContracts = await knex.schema.hasTable('client_contracts');
  if (!hasClientContracts) {
    // Fallback to legacy table name
    const exists = await knex.schema.hasTable('client_plan_bundles');
    if (!exists) return;
  }

  const tableName = hasClientContracts ? 'client_contracts' : 'client_plan_bundles';

  // Revert back to timestamp with time zone at midnight UTC
  await knex.raw(`
    ALTER TABLE ${tableName}
    ALTER COLUMN start_date TYPE timestamptz USING (start_date::timestamp AT TIME ZONE 'UTC'),
    ALTER COLUMN end_date TYPE timestamptz USING (end_date::timestamp AT TIME ZONE 'UTC');
  `);
};

