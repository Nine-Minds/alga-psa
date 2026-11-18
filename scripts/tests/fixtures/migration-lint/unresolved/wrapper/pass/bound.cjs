// Unresolved (green): every call site binds the executor; safe statements and typeof-narrowed helpers resolve.
async function onOneConnection(knex, work) {
  const connection = await knex.client.acquireConnection();
  const run = (sql, bindings) => knex.raw(sql, bindings ?? []).connection(connection);
  try {
    return await work(run);
  } finally {
    await knex.client.releaseConnection(connection);
  }
}

async function lockRetry(knex, statement) {
  return typeof statement === 'function' ? await statement(knex) : await knex.raw(statement);
}

function setLockTimeout(run) {
  return run(`SET lock_timeout = '2s'`);
}

exports.config = { transaction: false };

exports.up = async function (knex) {
  await lockRetry(knex, `SELECT 1`);
  await lockRetry(knex, (trx) => trx.raw(`SELECT 2`));
  await onOneConnection(knex, async (run) => {
    await setLockTimeout(run);
    await run(`ALTER TABLE comments ADD COLUMN IF NOT EXISTS extra int`);
  });
};
