/** An interrupted CREATE INDEX CONCURRENTLY can leave an invalid index whose
 * name makes IF NOT EXISTS skip every retry. Remove only that invalid artifact
 * before retrying the caller's declarative creation statement. */
async function ensureConcurrentIndex(knex, name, createSql) {
  const result = await knex.raw('SELECT indisvalid FROM pg_index WHERE indexrelid = to_regclass(?)', [name]);
  if (result.rows[0]?.indisvalid === false) {
    await knex.raw('DROP INDEX CONCURRENTLY IF EXISTS ??', [name]);
  }
  await knex.raw(createSql);
}

module.exports = { ensureConcurrentIndex };
