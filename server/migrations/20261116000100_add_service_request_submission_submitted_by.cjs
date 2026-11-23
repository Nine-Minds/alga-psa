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
 * column needs no distribution change). The index is built CONCURRENTLY (Citus supports this on
 * distributed tables, as in 20261002090000_add_portal_manager_scope.cjs), so the migration runs
 * outside a transaction and every step is idempotent.
 */

const TABLE = 'service_request_submissions';
const INDEX = 'service_request_submissions_submitter_client_key_unique';

/** A CONCURRENTLY build that was interrupted leaves an INVALID index that IF NOT EXISTS would skip. */
async function dropInvalidIndex(knex) {
  const { rows } = await knex.raw(
    `SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
     WHERE c.relname = ? AND c.relnamespace = current_schema()::regnamespace AND NOT i.indisvalid`,
    [INDEX]
  );
  if (rows.length > 0) {
    await knex.raw(`DROP INDEX CONCURRENTLY IF EXISTS ${INDEX}`);
  }
}

/**
 * @param {import('knex').Knex} knex
 */
exports.up = async function up(knex) {
  if (!(await knex.schema.hasColumn(TABLE, 'submitted_by_user_id'))) {
    await knex.raw(`ALTER TABLE ${TABLE} ADD COLUMN IF NOT EXISTS submitted_by_user_id uuid NULL`);
  }

  await dropInvalidIndex(knex);
  await knex.raw(`CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS ${INDEX}
    ON ${TABLE} (tenant, submitted_by_user_id, definition_id, client_submission_key)
    WHERE client_submission_key IS NOT NULL AND requester_user_id IS NULL`);
};

/**
 * @param {import('knex').Knex} knex
 */
exports.down = async function down(knex) {
  await knex.raw(`DROP INDEX CONCURRENTLY IF EXISTS ${INDEX}`);
  if (await knex.schema.hasColumn(TABLE, 'submitted_by_user_id')) {
    await knex.raw(`ALTER TABLE ${TABLE} DROP COLUMN IF EXISTS submitted_by_user_id`);
  }
};

exports.config = { transaction: false };
