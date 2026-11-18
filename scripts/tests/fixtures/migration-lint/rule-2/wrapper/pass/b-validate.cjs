// Rule 2 (green, wrapper 2 of 2): VALIDATE reaches the lint through an onOneConnection-style run callback.
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
    await run(`ALTER TABLE comments VALIDATE CONSTRAINT comments_len_check`);
  });
};
