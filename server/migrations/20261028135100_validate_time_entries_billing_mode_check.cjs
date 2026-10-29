// CM L6a1 (2 of 2 for time_entries.billing_mode): VALIDATE only.
// Takes SHARE UPDATE EXCLUSIVE for one scan while reads and writes continue,
// so it lives in its own non-transactional file. Idempotent; no-op when the
// constraint is absent.
const CHECK = 'time_entries_billing_mode_check';

exports.config = { transaction: false };

exports.up = async function up(knex) {
  if (!(await knex.schema.hasTable('time_entries'))) return;
  const { rows } = await knex.raw(
    `SELECT convalidated FROM pg_constraint WHERE conname = ? AND conrelid = 'time_entries'::regclass`,
    [CHECK]
  );
  if (!rows.length || rows[0].convalidated) return;
  await knex.raw(`ALTER TABLE time_entries VALIDATE CONSTRAINT ${CHECK}`);
};

exports.down = async function down() {
  // Forward-only: a validated constraint is not un-validated.
};
