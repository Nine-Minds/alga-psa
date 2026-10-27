// Step 2 of 2 for users.is_inactive (see 20261026090000_require_user_active_state).
// VALIDATE takes SHARE UPDATE EXCLUSIVE for one scan while reads and writes
// continue; SET NOT NULL then reuses the validated check and does not rescan
// (PostgreSQL 12+), and the check is dropped as redundant.
//
// Runs outside a transaction so the scan's lock is not held with anything else.
const CONSTRAINT = 'users_is_inactive_not_null';

async function ensureSequentialMode(knex) {
  await knex.raw(`
    DO $$
    BEGIN
      IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'citus') THEN
        EXECUTE 'SET citus.multi_shard_modify_mode TO ''sequential''';
      END IF;
    END $$;
  `);
}

exports.config = { transaction: false };

exports.up = async function up(knex) {
  await ensureSequentialMode(knex);
  if (!(await knex.schema.hasTable('users')) || !(await knex.schema.hasColumn('users', 'is_inactive'))) {
    return;
  }

  const { rows } = await knex.raw(
    `SELECT 1 FROM pg_constraint WHERE conname = ? AND conrelid = 'users'::regclass`,
    [CONSTRAINT]
  );
  if (rows.length > 0) {
    await knex.raw(`ALTER TABLE users VALIDATE CONSTRAINT ${CONSTRAINT}`);
  }
  await knex.raw(`ALTER TABLE users ALTER COLUMN is_inactive SET NOT NULL`);
  await knex.raw(`ALTER TABLE users DROP CONSTRAINT IF EXISTS ${CONSTRAINT}`);
};

exports.down = async function down() {
  // Forward-only: a NOT NULL column is never relaxed again.
};
