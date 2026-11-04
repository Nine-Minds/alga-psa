/**
 * FileStoreModel.updateMetadata (and create) write `external_files.metadata`,
 * but no migration ever created the column. Add it if missing.
 * Additive and idempotent; no backfill (existing rows stay NULL).
 */
exports.up = async function up(knex) {
  await knex.raw('ALTER TABLE external_files ADD COLUMN IF NOT EXISTS metadata jsonb');
};

exports.down = async function down(knex) {
  await knex.raw('ALTER TABLE external_files DROP COLUMN IF EXISTS metadata');
};
