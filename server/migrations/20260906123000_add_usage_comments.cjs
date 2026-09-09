// The Add/Edit Usage form already accepts comments. Persist them on the same
// tenant-distributed row as the usage event. Nullable text preserves old rows
// without a backfill and uses ordinary DDL supported by PostgreSQL and Citus.
exports.up = async function (knex) {
  await knex.schema.alterTable('usage_tracking', (table) => {
    table.text('comments').nullable();
  });
};

exports.down = async function (knex) {
  await knex.schema.alterTable('usage_tracking', (table) => {
    table.dropColumn('comments');
  });
};
