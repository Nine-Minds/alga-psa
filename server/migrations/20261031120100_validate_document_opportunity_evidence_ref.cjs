// VALIDATE only, in its own non-transactional file (migration lint R2): one scan under SHARE UPDATE
// EXCLUSIVE while reads and writes continue. Pairs with 20261031120000, which adds the CHECK NOT VALID.
// Idempotent; no-op when absent or already valid.
const TABLE = 'opportunity_evidence';
const NAME = 'opportunity_evidence_ref_type_check';

exports.config = { transaction: false };

exports.up = async function up(knex) {
  const { rows } = await knex.raw('SELECT convalidated FROM pg_constraint WHERE conname = ? AND conrelid = ?::regclass', [NAME, TABLE]);
  if (!rows.length || rows[0].convalidated) return;
  await knex.raw('ALTER TABLE opportunity_evidence VALIDATE CONSTRAINT opportunity_evidence_ref_type_check');
};

exports.down = async function down() {
  // Forward-only: a validated constraint is not un-validated. 20261031120000's down re-adds the constraint.
};
