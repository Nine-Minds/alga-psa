// CM L6c (2 of 3): VALIDATE only. One scan under SHARE UPDATE EXCLUSIVE while
// reads and writes continue, so it lives in its own non-transactional file.
// Idempotent; no-op when the constraint is absent or already valid.
const CHECK = 'online_meetings_co_managed_sync_intent';

exports.config = { transaction: false };

exports.up = async function up(knex) {
  if (!(await knex.schema.hasTable('online_meetings'))) return;
  const { rows } = await knex.raw(
    `SELECT convalidated FROM pg_constraint WHERE conname = ? AND conrelid = 'online_meetings'::regclass`,
    [CHECK]
  );
  if (!rows.length || rows[0].convalidated) return;
  await knex.raw(`ALTER TABLE online_meetings VALIDATE CONSTRAINT ${CHECK}`);
};

exports.down = async function down() {
  // Forward-only: a validated constraint is not un-validated. The NOT VALID
  // file's down removes the constraint.
};
