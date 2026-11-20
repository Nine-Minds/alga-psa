/**
 * quote_decisions.agreement_version: which version of the acceptance wording the
 * signer agreed to (agreement_text_hash is the hash of that exact wording).
 * Additive, nullable: older rows and portal / MSP-marked decisions have none.
 * Plain ADD COLUMN is safe on a Citus-distributed table.
 */
exports.up = async function up(knex) {
  await knex.raw('ALTER TABLE quote_decisions ADD COLUMN IF NOT EXISTS agreement_version text NULL');
};

exports.down = async function down(knex) {
  await knex.raw('ALTER TABLE quote_decisions DROP COLUMN IF EXISTS agreement_version');
};
