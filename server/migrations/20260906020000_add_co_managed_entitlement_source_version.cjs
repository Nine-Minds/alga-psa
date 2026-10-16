// Guarded with hasColumn, as 240 other migrations in this directory are. The
// combined-migration and bootstrap lanes replay this schema over a database
// that has already been migrated, so an unguarded alterTable fails the whole
// run with `column "source_version" ... already exists`.
exports.up = async function up(knex) {
  if (await knex.schema.hasColumn('co_managed_entitlements', 'source_version')) return;
  await knex.schema.alterTable('co_managed_entitlements', (table) => {
    // Signed license issue time prevents delayed refreshes replacing a newer license.
    table.bigInteger('source_version').notNullable().defaultTo(0);
  });
};

exports.down = async function down(knex) {
  if (!await knex.schema.hasColumn('co_managed_entitlements', 'source_version')) return;
  await knex.schema.alterTable('co_managed_entitlements', (table) => table.dropColumn('source_version'));
};
