// Rule 2 (red, wrapper 2 of 2): the wrapper runs other SQL; there is no VALIDATE CONSTRAINT anywhere.
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
    await run(`SELECT 1`);
  });
};
