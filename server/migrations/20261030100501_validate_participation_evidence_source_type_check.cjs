// CM L4a (7 of 8): VALIDATE only, in its own non-transactional file (one scan under SHARE UPDATE
// EXCLUSIVE while reads and writes continue). Idempotent; no-op when absent or already valid.
const TABLE = 'co_managed_participation_evidence';
const NAME = 'co_managed_participation_evidence_source_type_check';

exports.config = { transaction: false };

exports.up = async function up(knex) {
  if (!(await knex.schema.hasTable(TABLE))) return;
  const { rows } = await knex.raw('SELECT convalidated FROM pg_constraint WHERE conname = ? AND conrelid = ?::regclass', [NAME, TABLE]);
  if (!rows.length || rows[0].convalidated) return;
  await knex.raw('ALTER TABLE co_managed_participation_evidence VALIDATE CONSTRAINT co_managed_participation_evidence_source_type_check');
};

exports.down = async function down() {
  // Forward-only: a validated constraint is not un-validated. 20261030100500's down removes the constraint.
};
