// Rule 5 (green): per-batch loop with ORDER BY + LIMIT and a per-batch transaction.
const BATCH_SIZE = 100;

async function migrateBatch(knex) {
  return knex.transaction(async (trx) => {
    const rows = await trx('comments').whereNull('note').orderBy('id').limit(BATCH_SIZE).select('id');
    if (rows.length === 0) return 0;
    for (const row of rows) {
      await trx('comments').where({ id: row.id }).update({ note: '' });
    }
    return rows.length;
  });
}

exports.up = async function (knex) {
  while ((await migrateBatch(knex)) > 0) {
    // keep going
  }
  let n = 0;
  do {
    const res = await knex.raw('UPDATE time_entries SET note = \'\' WHERE id IN (SELECT id FROM time_entries WHERE note IS NULL LIMIT 100)');
    n = res.rowCount;
  } while (n > 0);
};
