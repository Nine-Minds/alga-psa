// CM L4b (4 of 5): the only change L4b makes to an L4a table (plan A6). A nullable soft reference
// from a private thread to the disclosure that moved it into the shared conversation. Deliberately
// no foreign key and no trigger: the invariant lives in application code (PLAN §3). Expand-only,
// metadata-only ADD COLUMN, guarded so it is safe to re-run and a no-op if L4a's table is absent.
const TABLE = 'co_management_private_threads';
const COLUMN = 'disclosure_operation_id';
exports.config = { transaction: false };
exports.up = async function (knex) {
  if (!await knex.schema.hasTable(TABLE)) return;
  if (!await knex.schema.hasColumn(TABLE, COLUMN)) await knex.schema.alterTable(TABLE, table => table.uuid(COLUMN).nullable());
};
exports.down = async function (knex) {
  if (!await knex.schema.hasTable(TABLE) || !await knex.schema.hasColumn(TABLE, COLUMN)) return;
  if (await knex(TABLE).whereNotNull(COLUMN).first()) throw new Error('Cannot discard retained co-managed disclosure history');
  await knex.schema.alterTable(TABLE, table => table.dropColumn(COLUMN));
};
