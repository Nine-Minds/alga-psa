/**
 * quote_decisions.content_fingerprint: sha256 of the exact public quote content (the
 * publicQuoteView projection) the signer was shown and signed. Additive, nullable:
 * portal / MSP-marked decisions and older rows have none. Plain ADD COLUMN is safe on a
 * Citus-distributed table.
 */
exports.up = async function up(knex) {
  await knex.raw('ALTER TABLE quote_decisions ADD COLUMN IF NOT EXISTS content_fingerprint text NULL');
};

exports.down = async function down(knex) {
  await knex.raw('ALTER TABLE quote_decisions DROP COLUMN IF EXISTS content_fingerprint');
};
