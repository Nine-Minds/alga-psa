// Rule 3 (red): an unsafe statement sent through the wrapper is still seen, including via a named callback, a helper and nesting.
async function onOneConnection(knex, work) {
  const connection = await knex.client.acquireConnection();
  const run = (sql, bindings) => knex.raw(sql, bindings ?? []).connection(connection);
  try {
    return await work(run);
  } finally {
    await knex.client.releaseConnection(connection);
  }
}

async function dropNote(run) {
  // lint-expect: 3
  await run(`ALTER TABLE comments DROP COLUMN note`);
}

async function renameInner(run) {
  await run(
    // lint-expect: 3
    `ALTER TABLE time_entries RENAME COLUMN notes TO memo`
  );
}

async function viaName(run) {
  await dropNote(run);
}

exports.config = { transaction: false };

exports.up = async function (knex) {
  await onOneConnection(knex, viaName);
  await onOneConnection(knex, async (outer) => {
    await onOneConnection(knex, async (inner) => {
      await renameInner(inner);
    });
  });
};
