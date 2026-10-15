/**
 * Migration: add a claim heartbeat to answer-mapping application runs.
 *
 * `service_request_submission_applications.status = 'pending'` marks an in-flight
 * apply claim. It is not by itself proof of a live owner: if the process dies
 * mid-run the row stays `pending` forever and retries can never take it over.
 * `claimed_at` is refreshed by the owning run before each field, so a retry can
 * distinguish a live concurrent run (fresh heartbeat) from an abandoned one
 * (stale heartbeat) and recover the latter.
 *
 * Existing rows are backfilled from `applied_at` (the moment they were claimed),
 * not from `now()`, so a row already stuck pending is immediately recoverable.
 *
 * The table is Citus-distributed on `tenant`; the column add/backfill runs
 * outside a transaction block per the mapping-tables migration style.
 */

/**
 * @param {import('knex').Knex} knex
 */
exports.up = async function up(knex) {
  const hasColumn = await knex.schema.hasColumn(
    'service_request_submission_applications',
    'claimed_at'
  );
  if (hasColumn) {
    return;
  }

  await knex.schema.alterTable('service_request_submission_applications', (table) => {
    table.timestamp('claimed_at', { useTz: true }).nullable();
  });
  await knex.raw(`
    UPDATE service_request_submission_applications
    SET claimed_at = applied_at
    WHERE claimed_at IS NULL
  `);
  await knex.raw(`
    ALTER TABLE service_request_submission_applications
    ALTER COLUMN claimed_at SET NOT NULL
  `);
  await knex.raw(`
    ALTER TABLE service_request_submission_applications
    ALTER COLUMN claimed_at SET DEFAULT now()
  `);
};

/**
 * @param {import('knex').Knex} knex
 */
exports.down = async function down(knex) {
  const hasColumn = await knex.schema.hasColumn(
    'service_request_submission_applications',
    'claimed_at'
  );
  if (hasColumn) {
    await knex.schema.alterTable('service_request_submission_applications', (table) => {
      table.dropColumn('claimed_at');
    });
  }
};

exports.config = { transaction: false };
