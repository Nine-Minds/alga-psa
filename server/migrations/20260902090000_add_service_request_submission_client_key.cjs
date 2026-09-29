/**
 * Migration: add a durable client submission key to service request submissions.
 *
 * The portal generates one opaque UUID per rendered form attempt and resubmits
 * it unchanged on retries. A tenant-scoped partial unique index over
 * (tenant, requester_user_id, definition_id, client_submission_key) turns that
 * key into a database-backed idempotency guarantee: same-key sequential or
 * concurrent retries resolve to one submission and at most one provider
 * execution. Rows without a key (internal callers, pre-existing submissions)
 * are exempt, preserving existing behavior.
 *
 * The index leads with the tenant distribution column, keeping it valid for
 * the Citus-distributed service_request_submissions table.
 */

/**
 * @param {import('knex').Knex} knex
 */
exports.up = async function up(knex) {
  const hasColumn = await knex.schema.hasColumn(
    'service_request_submissions',
    'client_submission_key'
  );
  if (!hasColumn) {
    await knex.schema.alterTable('service_request_submissions', (table) => {
      table.uuid('client_submission_key').nullable();
    });
  }

  await knex.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS service_request_submissions_client_key_unique
    ON service_request_submissions (tenant, requester_user_id, definition_id, client_submission_key)
    WHERE client_submission_key IS NOT NULL
  `);
};

/**
 * @param {import('knex').Knex} knex
 */
exports.down = async function down(knex) {
  await knex.raw('DROP INDEX IF EXISTS service_request_submissions_client_key_unique');
  const hasColumn = await knex.schema.hasColumn(
    'service_request_submissions',
    'client_submission_key'
  );
  if (hasColumn) {
    await knex.schema.alterTable('service_request_submissions', (table) => {
      table.dropColumn('client_submission_key');
    });
  }
};

exports.config = { transaction: false };
