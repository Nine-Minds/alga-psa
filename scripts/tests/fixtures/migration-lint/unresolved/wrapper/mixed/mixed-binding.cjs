// Unresolved (red): `run` is the executor at one call site and an unknown value at another.
async function onOneConnection(knex, work) {
  const connection = await knex.client.acquireConnection();
  const run = (sql, bindings) => knex.raw(sql, bindings ?? []).connection(connection);
  try {
    return await work(run);
  } finally {
    await knex.client.releaseConnection(connection);
  }
}

async function apply(run) {
  // lint-expect: UNRESOLVED
  await run(`ALTER TABLE comments DROP COLUMN note`);
}

exports.config = { transaction: false };

exports.up = async function (knex) {
  await onOneConnection(knex, async (run) => {
    await apply(run);
  });
  await apply(knex.client.somethingElse);
};
