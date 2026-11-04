async function withLockRetry(knex, statement) {
  await knex.raw('SAVEPOINT lock_retry');
  const result = await knex.raw(statement);
  await knex.raw('RELEASE SAVEPOINT lock_retry');
  return result;
}

exports.up = async function (knex) {
  // migration-lint: allow 3 - reviewed: varchar to text is binary-coercible, no rewrite
  await withLockRetry(knex, 'ALTER TABLE time_entries ALTER COLUMN notes TYPE text');
  await withLockRetry(knex, 'ALTER TABLE comments DROP COLUMN note');
};
