/**
 * Migration: record who filed a service request submission on a requester's behalf.
 *
 * `submitted_by_user_id` is the MSP user who filed the submission for a client
 * contact (alga-2026-0003313). NULL means the requester filed it themselves;
 * existing rows are deliberately not backfilled.
 *
 * Idempotency: the existing client-key unique index is keyed on
 * requester_user_id, and Postgres treats NULLs as distinct, so a contact with no
 * portal user would not be deduplicated. A second partial unique index keyed on
 * the submitter covers exactly the requester-less rows.
 *
 * Both objects lead with the tenant distribution column, so they remain valid on
 * the Citus-distributed service_request_submissions table (adding a nullable
 * column needs no distribution change).
 */

/**
 * @param {import('knex').Knex} knex
 */
exports.up = async function up(knex) {
  const hasColumn = await knex.schema.hasColumn('service_request_submissions', 'submitted_by_user_id');
  if (!hasColumn) {
    await knex.schema.alterTable('service_request_submissions', (table) => {
      table.uuid('submitted_by_user_id').nullable();
    });
  }

  await knex.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS service_request_submissions_submitter_client_key_unique
    ON service_request_submissions (tenant, submitted_by_user_id, definition_id, client_submission_key)
    WHERE client_submission_key IS NOT NULL AND requester_user_id IS NULL
  `);
};

/**
 * @param {import('knex').Knex} knex
 */
exports.down = async function down(knex) {
  await knex.raw('DROP INDEX IF EXISTS service_request_submissions_submitter_client_key_unique');
  const hasColumn = await knex.schema.hasColumn('service_request_submissions', 'submitted_by_user_id');
  if (hasColumn) {
    await knex.schema.alterTable('service_request_submissions', (table) => {
      table.dropColumn('submitted_by_user_id');
    });
  }
};

exports.config = { transaction: false };
