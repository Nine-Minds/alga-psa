/**
 * Streamed uploads compute a running sha256 of the stored bytes. Record it on
 * external_files so later cards (dedupe, integrity checks) can use it.
 * Additive and idempotent; no backfill (existing rows stay NULL).
 */
exports.up = async function up(knex) {
  await knex.raw('ALTER TABLE external_files ADD COLUMN IF NOT EXISTS content_sha256 text');
};

exports.down = async function down(knex) {
  await knex.raw('ALTER TABLE external_files DROP COLUMN IF EXISTS content_sha256');
};
