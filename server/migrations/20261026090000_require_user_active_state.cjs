// users.is_inactive is a strict boolean. Seat admission and seat counts read
// `is_inactive = false` while sign-in treats any falsy value as active, so a
// NULL row was a working account that no seat count saw. NULL has always meant
// active at sign-in; keep that meaning (backfill to false) and forbid it from
// here on.
//
// Step 1 of 2: no long locks. The NOT VALID check is catalog-only and already
// rejects new NULLs; 20261026090100 validates it and sets NOT NULL.
const BATCH_SIZE = 5000;
const CONSTRAINT = 'users_is_inactive_not_null';
const LOCK_ATTEMPTS = 3;

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

async function hasConstraint(knex) {
  const { rows } = await knex.raw(
    `SELECT 1 FROM pg_constraint WHERE conname = ? AND conrelid = 'users'::regclass`,
    [CONSTRAINT]
  );
  return rows.length > 0;
}

function rowCount(result) {
  return typeof result.rowCount === 'number' ? result.rowCount : 0;
}

// Runs one DDL statement under a short lock_timeout. A lock timeout aborts the
// statement only (savepoint), so the migration transaction can try again.
async function withLockRetry(knex, sql) {
  for (let attempt = 1; ; attempt += 1) {
    await knex.raw(`SAVEPOINT lock_retry`);
    try {
      await knex.raw(`SET LOCAL lock_timeout = '2s'`);
      await knex.raw(sql);
      await knex.raw(`RELEASE SAVEPOINT lock_retry`);
      return;
    } catch (error) {
      if (error.code !== '55P03' || attempt >= LOCK_ATTEMPTS) throw error;
      await knex.raw(`ROLLBACK TO SAVEPOINT lock_retry`);
    }
  }
}

exports.up = async function up(knex) {
  await ensureSequentialMode(knex);
  if (!(await knex.schema.hasTable('users')) || !(await knex.schema.hasColumn('users', 'is_inactive'))) {
    return;
  }

  // Catalog-only; retry if a busy users table (every auth lookup reads it)
  // keeps the brief ACCESS EXCLUSIVE lock waiting.
  await withLockRetry(knex, `ALTER TABLE users ALTER COLUMN is_inactive SET DEFAULT false`);

  // Per-tenant batches keep every UPDATE single-shard on Citus.
  const tenants = await knex('tenants').select('tenant');
  for (const { tenant } of tenants) {
    let moved;
    do {
      moved = await knex.raw(
        `UPDATE users SET is_inactive = false
          WHERE tenant = ? AND is_inactive IS NULL
            AND user_id IN (SELECT user_id FROM users WHERE tenant = ? AND is_inactive IS NULL LIMIT ${BATCH_SIZE})`,
        [tenant, tenant]
      );
    } while (rowCount(moved) === BATCH_SIZE);
  }

  if (!(await hasConstraint(knex))) {
    await withLockRetry(
      knex,
      `ALTER TABLE users ADD CONSTRAINT ${CONSTRAINT} CHECK (is_inactive IS NOT NULL) NOT VALID`
    );
  }
};

exports.down = async function down(knex) {
  // Forward-only: the data change is never undone and NULLs are never resurrected.
  await knex.raw(`ALTER TABLE users DROP CONSTRAINT IF EXISTS ${CONSTRAINT}`);
};
