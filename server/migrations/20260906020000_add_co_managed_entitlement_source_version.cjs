exports.up = async function up(knex) {
  await knex.schema.alterTable('co_managed_entitlements', (table) => {
    // Signed license issue time prevents delayed refreshes replacing a newer license.
    table.bigInteger('source_version').notNullable().defaultTo(0);
  });
};

exports.down = async function down(knex) {
  await knex.schema.alterTable('co_managed_entitlements', (table) => table.dropColumn('source_version'));
};
