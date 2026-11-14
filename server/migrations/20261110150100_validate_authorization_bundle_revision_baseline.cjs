// VALIDATE only. The scan runs under SHARE UPDATE EXCLUSIVE while reads and writes continue, so it
// lives in its own non-transactional file. Idempotent: a no-op when the constraint is absent or
// already valid.
exports.config = { transaction: false };

const TABLE = 'authorization_bundle_revisions';
const CHECK = 'authorization_bundle_revisions_baseline_check';

/** @param { import("knex").Knex } knex */
exports.up = async function up(knex) {
  if (!(await knex.schema.hasTable(TABLE))) return;
  const { rows } = await knex.raw(
    `SELECT convalidated FROM pg_constraint WHERE conname = ? AND conrelid = ?::regclass`,
    [CHECK, TABLE],
  );
  if (rows.length > 0 && !rows[0].convalidated) await knex.raw(`ALTER TABLE ${TABLE} VALIDATE CONSTRAINT ${CHECK}`);
};

exports.down = async function down() {
  // Forward-only: a validated constraint is not un-validated. 20261110150000's down removes the constraint.
};
