/**
 * Migration: Add job runner metadata columns
 *
 * This migration adds columns to track which job runner (PG Boss or Temporal)
 * executed each job, along with external identifiers for debugging and monitoring.
 *
 * Changes:
 * - runner_type: 'pgboss' or 'temporal' to identify the execution engine
 * - external_id: PG Boss job ID or Temporal workflow ID
 * - external_run_id: Temporal run ID (for workflow versioning)
 */

exports.up = async (knex) => {
  // Check if columns already exist to make migration idempotent
  const hasRunnerType = await knex.schema.hasColumn('jobs', 'runner_type');

  if (!hasRunnerType) {
    await knex.schema.alterTable('jobs', (table) => {
      // Track which runner executed this job
      table.string('runner_type', 50).defaultTo('pgboss').notNullable();
      // Store external reference (PG Boss job ID or Temporal workflow ID)
      table.string('external_id', 255).nullable();
      // Store Temporal run ID for workflow tracking
      table.string('external_run_id', 255).nullable();
    });

    // Add index for external ID lookups
    await knex.raw(`
      CREATE INDEX IF NOT EXISTS idx_jobs_external_id
      ON jobs(external_id)
      WHERE external_id IS NOT NULL
    `);

    // Add index for runner type queries (useful for monitoring)
    await knex.raw(`
      CREATE INDEX IF NOT EXISTS idx_jobs_runner_type
      ON jobs(runner_type)
    `);

    console.log('Added job runner metadata columns to jobs table');
  } else {
    console.log('Job runner metadata columns already exist, skipping');
  }
};

exports.down = async (knex) => {
  // Drop indexes first
  await knex.raw('DROP INDEX IF EXISTS idx_jobs_external_id');
  await knex.raw('DROP INDEX IF EXISTS idx_jobs_runner_type');

  // Check if columns exist before trying to drop them
  const hasRunnerType = await knex.schema.hasColumn('jobs', 'runner_type');

  if (hasRunnerType) {
    await knex.schema.alterTable('jobs', (table) => {
      table.dropColumn('runner_type');
      table.dropColumn('external_id');
      table.dropColumn('external_run_id');
    });
    console.log('Removed job runner metadata columns from jobs table');
  }
};
