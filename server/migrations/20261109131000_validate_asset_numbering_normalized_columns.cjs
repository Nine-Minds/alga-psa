/** Validate canonical normalization checks after the resumable backfill. */
exports.up = async function up(knex) {
  await knex.raw('ALTER TABLE assets VALIDATE CONSTRAINT assets_asset_tag_normalized_ck');
  await knex.raw('ALTER TABLE clients VALIDATE CONSTRAINT clients_asset_prefix_normalized_ck');
};

// Validation is safe to repeat and removing it would make the prior migration
// inconsistent, so rollback intentionally leaves the checks in place.
exports.down = async function down() {};

exports.config = { transaction: false };
