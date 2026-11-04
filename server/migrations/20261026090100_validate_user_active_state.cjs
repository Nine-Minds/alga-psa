// Step 2 of 2 for users.is_inactive (see 20261026090000_require_user_active_state).
// VALIDATE takes SHARE UPDATE EXCLUSIVE for one scan while reads and writes
// continue; SET NOT NULL then reuses the validated check and does not rescan
// (PostgreSQL 12+), and the check is dropped as redundant.
//
// Runs outside a transaction so the scan's lock is not held with anything else.
// Without a transaction knex hands each statement whatever pooled connection is
// free, so a session-level SET would not reliably reach the DDL after it. Every
// statement here therefore runs on one connection acquired for the migration,
// and the setting is reset before that connection goes back to the pool.
const CONSTRAINT = 'users_is_inactive_not_null';

async function onOneConnection(knex, work) {
  const connection = await knex.client.acquireConnection();
  const run = (sql, bindings) => knex.raw(sql, bindings ?? []).connection(connection);
  try {
    return await work(run);
  } finally {
    try {
      await run(`
        DO $$
        BEGIN
          IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'citus') THEN
            EXECUTE 'RESET citus.multi_shard_modify_mode';
          END IF;
        END $$;
      `);
    } finally {
      await knex.client.releaseConnection(connection);
    }
  }
}

async function ensureSequentialMode(run) {
  await run(`
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
  if (!(await knex.schema.hasTable('users')) || !(await knex.schema.hasColumn('users', 'is_inactive'))) {
    return;
  }

  await onOneConnection(knex, async (run) => {
    await ensureSequentialMode(run);
    const { rows } = await run(
      `SELECT 1 FROM pg_constraint WHERE conname = ? AND conrelid = 'users'::regclass`,
      [CONSTRAINT]
    );
    if (rows.length > 0) {
      await run(`ALTER TABLE users VALIDATE CONSTRAINT ${CONSTRAINT}`);
    }
    // migration-lint: allow 3 - SET NOT NULL runs only after VALIDATE CONSTRAINT proved the column (PostgreSQL 12+ skips the rescan), on one connection with no other lock held
    await run(`ALTER TABLE users ALTER COLUMN is_inactive SET NOT NULL`);
    // migration-lint: allow 3 - drops the redundant check this migration pair added NOT VALID in 20261026090000; NOT NULL now enforces the invariant
    await run(`ALTER TABLE users DROP CONSTRAINT IF EXISTS ${CONSTRAINT}`);
  });
};

exports.down = async function down() {
  // Forward-only: a NOT NULL column is never relaxed again.
};
