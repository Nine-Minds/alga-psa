// Unresolved (red): the executor is handed to code the lint cannot follow.
async function onOneConnection(knex, work) {
  const connection = await knex.client.acquireConnection();
  const run = (sql, bindings) => knex.raw(sql, bindings ?? []).connection(connection);
  try {
    return await work(run);
  } finally {
    await knex.client.releaseConnection(connection);
  }
}

exports.config = { transaction: false };

exports.up = async function (knex) {
  await onOneConnection(knex, async (run) => {
    // lint-expect: UNRESOLVED
    await require('./elsewhere').execute(run);
  });
};
